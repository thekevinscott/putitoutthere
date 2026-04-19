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
    expect(line).toContain('[REDACTED]');
  });

  it('redacts values from keys matching *TOKEN*, *SECRET*, *PASSWORD*, *KEY*', () => {
    process.env.CARGO_REGISTRY_TOKEN = 'AAA';
    process.env.MY_SECRET = 'BBB';
    process.env.DATABASE_PASSWORD = 'CCC';
    process.env.ENCRYPTION_KEY = 'DDD';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('dump: AAA BBB CCC DDD');
    const line = dest.text;
    for (const v of ['AAA', 'BBB', 'CCC', 'DDD']) {
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
    process.env.CARGO_REGISTRY_TOKEN = 'abc-123';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('publishing', { tokenEcho: 'abc-123', package: 'x' });
    const line = dest.text;
    expect(line).not.toContain('abc-123');
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
    process.env.my_token = 'lowercased';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('payload: lowercased');
    expect(dest.text).not.toContain('lowercased');
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
