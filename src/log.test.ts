/**
 * Logger tests. Verifies JSON output, pretty-in-TTY, and redaction of
 * env-like secret values.
 *
 * Issue #11. Plan: §22.2, §22.5.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('redacts values from keys matching *TOKEN*, *SECRET*, *PASSWORD*, *KEY*', () => {
    // Values must clear the length floor (#137) — 8+ chars.
    process.env.CARGO_REGISTRY_TOKEN = 'AAAAAAAA1';
    process.env.MY_SECRET = 'BBBBBBBB1';
    process.env.DATABASE_PASSWORD = 'CCCCCCCC1';
    process.env.ENCRYPTION_KEY = 'DDDDDDDD1';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('dump: AAAAAAAA1 BBBBBBBB1 CCCCCCCC1 DDDDDDDD1');
    const line = dest.text;
    for (const v of ['AAAAAAAA1', 'BBBBBBBB1', 'CCCCCCCC1', 'DDDDDDDD1']) {
      expect(line).not.toContain(v);
    }
  });

  it('also redacts values from *PASS* and *PAT* name patterns', () => {
    process.env.MY_PASS_THING = 'passvalue-123';
    process.env.GH_PAT_TOKEN = 'patvalue-456';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('credentials: passvalue-123 patvalue-456');
    const line = dest.text;
    expect(line).not.toContain('passvalue-123');
    expect(line).not.toContain('patvalue-456');
  });

  it('does not redact values from keys outside the secret patterns', () => {
    process.env.PROJECT_NAME = 'dirsql';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('running for dirsql');
    expect(dest.text).toContain('dirsql');
  });

  it('redacts secrets inside structured fields, not just msg', () => {
    process.env.CARGO_REGISTRY_TOKEN = 'abc-12345678';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('publishing', { tokenEcho: 'abc-12345678', package: 'x' });
    const line = dest.text;
    expect(line).not.toContain('abc-12345678');
    expect(line).toContain('"package":"x"');
  });

  it('does not redact short env values that would mangle unrelated log text (#137)', () => {
    process.env.CI = '1';
    process.env.SHORT_TOKEN = 'abc'; // name matches but too short
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('status=1 count=3 abc things with 1 in text');
    const line = dest.text;
    // Neither the bare `1` nor the short `abc` should be touched.
    expect(line).toContain('status=1');
    expect(line).toContain('with 1 in text');
    expect(line).toContain('abc');
    expect(line).not.toMatch(/\[REDACTED:/);
  });

  it('redacts secrets from additional envSources, e.g. ctx.env (#136)', () => {
    const ctxEnv: Record<string, string> = {
      CARGO_REGISTRY_TOKEN: 'ctxenv-supersecret-value',
    };
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false, envSources: [ctxEnv] });
    log.info('publishing with ctxenv-supersecret-value in payload');
    const line = dest.text;
    expect(line).not.toContain('ctxenv-supersecret-value');
    expect(line).toMatch(/\[REDACTED:[0-9a-f]{8}\]/);
  });

  it('caches the redaction set across back-to-back log calls (#141)', () => {
    process.env.PERF_CHECK_TOKEN = 'perf-checksecret';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });

    // The full scan (regex match + length filter + sort) runs only on
    // cache miss: a stable env across N log calls sorts the values
    // exactly once. Spy on Array.prototype.sort to count those — our
    // sort is the only place sort runs inside redact().
    const sortSpy = vi.spyOn(Array.prototype, 'sort');
    const before = sortSpy.mock.calls.length;

    log.info('one perf-checksecret');
    log.info('two perf-checksecret');
    log.info('three perf-checksecret');

    const scanSorts = sortSpy.mock.calls.length - before;
    // Three log calls against a process.env that never changed; the
    // scan (and its sort) should fire exactly once.
    expect(scanSorts).toBe(1);
    sortSpy.mockRestore();

    // Sanity: redaction still works.
    expect(dest.text).not.toContain('perf-checksecret');
  });

  it('refreshes the cache when the source env mutates (#141)', () => {
    process.env.MUT_TOKEN = 'firstsecretvalue';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('phase1: firstsecretvalue');

    // Mutate process.env in place; the signature (key count + total
    // length) changes, which forces a rescan.
    process.env.MUT_TOKEN = 'differentsecrethere';
    log.info('phase2: differentsecrethere');

    expect(dest.text).not.toContain('firstsecretvalue');
    expect(dest.text).not.toContain('differentsecrethere');
  });

  it('handles empty-string secret values without blowing up', () => {
    process.env.EMPTY_TOKEN = '';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('nothing to hide');
    expect(dest.text).toContain('nothing to hide');
  });

  it('skips undefined env entries in extra sources without error', () => {
    // Handlers occasionally pass a ctx.env where a workflow forwarded an
    // optional var that happens to be unset; the scanner has to tolerate
    // `undefined` without tripping.
    const src: Record<string, string | undefined> = {
      GOOD_TOKEN: 'realtokenvalue-1234',
      MAYBE_TOKEN: undefined,
    };
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false, envSources: [src] });
    log.info('payload: realtokenvalue-1234');
    expect(dest.text).not.toContain('realtokenvalue-1234');
  });

  it('case-insensitive on the env key pattern', () => {
    process.env.my_token = 'lowercased-value-1234';
    const dest = new BufStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('payload: lowercased-value-1234');
    expect(dest.text).not.toContain('lowercased-value-1234');
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
