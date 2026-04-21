/**
 * Logger tests. Verifies JSON output, pretty-in-TTY, and redaction of
 * env-like secret values.
 *
 * Issue #11. Plan: §22.2, §22.5.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger } from './log.js';

class BufStream extends Writable {
  chunks: string[] = [];
  override _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
    this.chunks.push(chunk.toString('utf8'));
    cb();
  }
  get text(): string {
    return this.chunks.join('');
  }
}

const ENV_BAK = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ENV_BAK)) delete process.env[k];
  }
  Object.assign(process.env, ENV_BAK);
});

describe('createLogger: JSON mode', () => {
  let dest: BufStream;
  beforeEach(() => {
    dest = new BufStream();
  });

  it('emits one JSON object per line with level, msg, and fields', () => {
    const log = createLogger({ stream: dest, pretty: false });
    log.info('hello', { pkg: 'a' });
    const line = dest.text.trim();
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.msg).toBe('hello');
    expect(parsed.pkg).toBe('a');
    expect(typeof parsed.level).toBe('string');
  });

  it('supports debug / info / warn / error levels', () => {
    const log = createLogger({ stream: dest, pretty: false, level: 'debug' });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    const lines = dest.text.trim().split('\n');
    expect(lines).toHaveLength(4);
  });

  it('drops messages below the configured level', () => {
    const log = createLogger({ stream: dest, pretty: false, level: 'warn' });
    log.debug('d');
    log.info('i');
    log.warn('w');
    const lines = dest.text.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0]!) as Record<string, unknown>).msg).toBe('w');
  });
});

describe('createLogger: redaction (§22.5)', () => {
  it('redacts known-secret env values anywhere in the message', () => {
    process.env.MY_SECRET_TOKEN = 'super-sensitive-value';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('saw token: super-sensitive-value in response');
    const line = dest.text;
    expect(line).not.toContain('super-sensitive-value');
    // #134: redactor uses digest-based markers so rotated tokens stay
    // distinguishable in logs without leaking the value.
    expect(line).toMatch(/\[REDACTED:[0-9a-f]{8}\]/);
  });

  it('uses a stable per-token digest marker so rotated tokens are distinguishable (#134)', () => {
    process.env.A_SECRET_TOKEN = 'first-token-value';
    process.env.B_SECRET_TOKEN = 'second-token-value';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('both here: first-token-value then second-token-value');
    const line = dest.text;
    const markers = [...line.matchAll(/\[REDACTED:([0-9a-f]{8})\]/g)].map((m) => m[1]);
    expect(markers).toHaveLength(2);
    expect(markers[0]).not.toBe(markers[1]);
  });

  it('redacts values from keys matching TOKEN, SECRET, PASSWORD, *_KEY', () => {
    process.env.CARGO_REGISTRY_TOKEN = 'credential-AAAAAAAA';
    process.env.MY_SECRET = 'credential-BBBBBBBB';
    process.env.DATABASE_PASSWORD = 'credential-CCCCCCCC';
    process.env.ENCRYPTION_KEY = 'credential-DDDDDDDD';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info(
      'dump: credential-AAAAAAAA credential-BBBBBBBB credential-CCCCCCCC credential-DDDDDDDD',
    );
    const line = dest.text;
    for (const v of [
      'credential-AAAAAAAA',
      'credential-BBBBBBBB',
      'credential-CCCCCCCC',
      'credential-DDDDDDDD',
    ]) {
      expect(line).not.toContain(v);
    }
  });

  it('does not redact values from keys outside the secret patterns', () => {
    process.env.PROJECT_NAME = 'dirsql';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('running for dirsql');
    expect(dest.text).toContain('dirsql');
  });

  it('redacts secrets inside structured fields, not just msg', () => {
    process.env.CARGO_REGISTRY_TOKEN = 'credential-abc-123';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('publishing', { tokenEcho: 'credential-abc-123', package: 'x' });
    const line = dest.text;
    expect(line).not.toContain('credential-abc-123');
    expect(line).toContain('"package":"x"');
  });

  it('handles empty-string secret values without blowing up', () => {
    process.env.EMPTY_TOKEN = '';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('nothing to hide');
    expect(dest.text).toContain('nothing to hide');
  });

  it('case-insensitive on the env key pattern', () => {
    process.env.my_token = 'lowercased-credential';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('payload: lowercased-credential');
    expect(dest.text).not.toContain('lowercased-credential');
  });

  it('does NOT redact short env values that could mangle unrelated text (#137)', () => {
    // A 2-char `*_KEY` value must not turn every occurrence of its
    // substring in logs into `[REDACTED]`. Floor is MIN_SECRET_LENGTH.
    process.env.ACCESS_KEY = 'v2';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('release v2 shipped on v2.0.1');
    expect(dest.text).toContain('v2');
  });

  it('does NOT redact from envs whose names merely contain TOKEN/KEY as substrings (#137)', () => {
    // KEYCLOAK_URL is not a secret — the regex must require a
    // whole-word match or a trailing `_KEY`. Value is long enough to
    // pass the length floor, so only the name gate keeps it safe.
    process.env.KEYCLOAK_URL = 'https://auth.example.com/realms/prod';
    process.env.TOKENIZER_MODEL = 'distilbert-base-uncased-finetuned';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('auth=https://auth.example.com/realms/prod model=distilbert-base-uncased-finetuned');
    expect(dest.text).toContain('https://auth.example.com/realms/prod');
    expect(dest.text).toContain('distilbert-base-uncased-finetuned');
  });

  it('still redacts *_KEY env values at or above the length floor (#137)', () => {
    // A genuinely credential-shaped ENCRYPTION_KEY should still be
    // caught: name matches `_KEY$`, value is long enough.
    process.env.ENCRYPTION_KEY = 'very-secret-encryption-key-xyz';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('loaded key: very-secret-encryption-key-xyz');
    expect(dest.text).not.toContain('very-secret-encryption-key-xyz');
    expect(dest.text).toMatch(/\[REDACTED:[0-9a-f]{8}\]/);
  });
});

describe('createLogger: pretty mode', () => {
  it('writes human-readable output (not pure JSON)', () => {
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: true });
    log.info('hello', { pkg: 'a' });
    // Pretty text still contains the message; not strict on format.
    expect(dest.text).toContain('hello');
    // First line should not parse as JSON.
    expect(() => JSON.parse(dest.text.trim().split('\n')[0]!) as unknown).toThrow();
  });

  it('stringifies object-valued fields (not just primitives)', () => {
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: true });
    log.info('obj', { meta: { a: 1 } });
    expect(dest.text).toContain('"a":1');
  });

  it('handles the no-fields branch', () => {
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: true });
    log.info('bare');
    expect(dest.text).toContain('bare');
  });

  it('auto-detects TTY when no `pretty` is passed', () => {
    // Simulate a TTY stream by tagging it.
    const dest = Object.assign(new BufStream(), { isTTY: true });
    const log = createLogger({ stream: dest });
    log.info('auto');
    // Pretty format prefixes with [LEVEL]; JSON would start with '{'.
    expect(dest.text.startsWith('[')).toBe(true);
  });
});
