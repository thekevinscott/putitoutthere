/**
 * Logger tests. Verifies JSON output, pretty-in-TTY, and redaction of
 * env-like secret values.
 *
 * Issue #11. Plan: §22.2, §22.5.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Writable } from 'node:stream';
import { createLogger } from './log.js';

// The logger only touches `stream.write()` and `stream.isTTY`; an in-memory
// double captures output without pulling `node:stream` (a runtime collaborator)
// into the unit. Typed as `Writable` (a type-only import, erased at compile
// time) so `createLogger`'s option stays checked.
type BufStream = Writable & { chunks: string[]; readonly text: string; isTTY?: boolean };

function makeStream(): BufStream {
  const chunks: string[] = [];
  return {
    chunks,
    write(chunk: string): boolean {
      chunks.push(chunk);
      return true;
    },
    get text(): string {
      return chunks.join('');
    },
  } as unknown as BufStream;
}

const ENV_BAK = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ENV_BAK)) {delete process.env[k];}
  }
  Object.assign(process.env, ENV_BAK);
});

describe('createLogger: JSON mode', () => {
  let dest: BufStream;
  beforeEach(() => {
    dest = makeStream();
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
    const dest = makeStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('saw token: super-sensitive-value in response');
    const line = dest.text;
    expect(line).not.toContain('super-sensitive-value');
    // #134: redactor uses digest-based markers so rotated tokens stay
    // distinguishable in logs without leaking the value.
    expect(line).toMatch(/\[REDACTED:[0-9a-f]{8}\]/);
  });

  it('redacts secrets inside structured fields, not just msg', () => {
    process.env.CARGO_REGISTRY_TOKEN = 'abc-12345678';
    const dest = makeStream();
    const log = createLogger({ stream: dest, pretty: false });
    log.info('publishing', { tokenEcho: 'abc-12345678', package: 'x' });
    const line = dest.text;
    expect(line).not.toContain('abc-12345678');
    expect(line).toContain('"package":"x"');
  });

  it('redacts secrets from additional envSources, e.g. ctx.env (#136)', () => {
    const ctxEnv: Record<string, string> = {
      CARGO_REGISTRY_TOKEN: 'ctxenv-supersecret-value',
    };
    const dest = makeStream();
    const log = createLogger({ stream: dest, pretty: false, envSources: [ctxEnv] });
    log.info('publishing with ctxenv-supersecret-value in payload');
    const line = dest.text;
    expect(line).not.toContain('ctxenv-supersecret-value');
    expect(line).toMatch(/\[REDACTED:[0-9a-f]{8}\]/);
  });
});

describe('createLogger: default stream', () => {
  it('writes to process.stderr when no stream is passed', () => {
    // Pins the `opts.stream ?? process.stderr` default (log.ts): stdout stays
    // clean for machine-readable `--json` output, so a stream-less logger must
    // land its line on stderr. Spy on the real fd so the default is exercised
    // end to end rather than through an injected double.
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const log = createLogger({ pretty: false });
      log.info('to-stderr', { pkg: 'a' });
      expect(spy).toHaveBeenCalledTimes(1);
      const written = String(spy.mock.calls[0]![0]);
      expect(JSON.parse(written.trim()) as Record<string, unknown>).toMatchObject({
        msg: 'to-stderr',
        pkg: 'a',
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('createLogger: pretty mode', () => {
  it('writes human-readable output (not pure JSON)', () => {
    const dest = makeStream();
    const log = createLogger({ stream: dest, pretty: true });
    log.info('hello', { pkg: 'a' });
    // Pretty text still contains the message; not strict on format.
    expect(dest.text).toContain('hello');
    // First line should not parse as JSON.
    expect(() => JSON.parse(dest.text.trim().split('\n')[0]!) as unknown).toThrow();
  });

  it('stringifies object-valued fields (not just primitives)', () => {
    const dest = makeStream();
    const log = createLogger({ stream: dest, pretty: true });
    log.info('obj', { meta: { a: 1 } });
    expect(dest.text).toContain('"a":1');
  });

  it('handles the no-fields branch', () => {
    const dest = makeStream();
    const log = createLogger({ stream: dest, pretty: true });
    log.info('bare');
    expect(dest.text).toContain('bare');
  });

  it('stringifies number / boolean / null scalar fields', () => {
    const dest = makeStream();
    const log = createLogger({ stream: dest, pretty: true });
    log.info('scalars', { count: 3, ok: true, nada: null });
    expect(dest.text).toContain('count=3');
    expect(dest.text).toContain('ok=true');
    expect(dest.text).toContain('nada=null');
  });

  it('auto-detects TTY when no `pretty` is passed', () => {
    // Simulate a TTY stream by tagging it.
    const dest = makeStream();
    dest.isTTY = true;
    const log = createLogger({ stream: dest });
    log.info('auto');
    // Pretty format prefixes with [LEVEL]; JSON would start with '{'.
    expect(dest.text.startsWith('[')).toBe(true);
  });
});
