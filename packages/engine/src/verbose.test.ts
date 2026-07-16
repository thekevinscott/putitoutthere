/**
 * Verbose-on-failure dump tests.
 *
 * Plan: §22.4.
 * Issue #15.
 *
 * Unit-isolated: `verbose.ts`'s two collaborators are mocked so this
 * suite exercises only `dumpFailure`'s own branching.
 *  - `node:fs` is automocked; the markdown written to
 *    `$GITHUB_STEP_SUMMARY` is asserted through the captured
 *    `appendFileSync` call rather than a real temp file.
 *  - `./log.js` is automocked; the pure `redact` helper is restored with
 *    a tiny faithful reimplementation (env-key secret match + length
 *    floor + longest-first replacement with an 8-hex marker) so the
 *    redaction contract is still exercised, and the structured record is
 *    asserted through a fake logger's `error` mock instead of parsing
 *    JSON off a real stream.
 *
 * The GHA-annotation cases capture `process.stdout.write` directly, as
 * the implementation writes there and it is not a module boundary.
 */

import { appendFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dumpFailure, type FailureContext } from './verbose.js';
import { redact } from './log.js';

vi.mock('node:fs');
vi.mock('./log.js');

/**
 * Credential-shaped env-var matcher — copied from `log.ts` so the mocked
 * `redact` stays faithful to which keys the real redactor treats as
 * secrets. Word-boundary anchored so `TOKENIZER`/`KEYCLOAK`-style names
 * don't false-positive.
 */
const SECRET_KEY = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PAT)(?:_|$)|(?:^|_)[A-Z0-9]*KEY$/i;
const MIN_OPAQUE_LEN = 8;

/**
 * 8-hex digest for the `[REDACTED:<digest>]` marker. The real redactor
 * uses a SHA-256 prefix; these tests only assert the `[0-9a-f]{8}` shape
 * (never the exact bytes), so a cheap stable hash keeps the reimpl free
 * of a `node:crypto` import while preserving the observable contract.
 */
function digest8(v: string): string {
  let h = 0;
  for (let i = 0; i < v.length; i++) {
    h = (h * 31 + v.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 8);
}

/** Tiny faithful reimplementation of `log.ts#redact` (see module note). */
function faithfulRedact(
  s: string,
  sources: readonly Record<string, string | undefined>[] = [process.env],
): string {
  let out = s;
  for (const src of sources) {
    const values: string[] = [];
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (!v || v.length < MIN_OPAQUE_LEN) {continue;}
      if (!SECRET_KEY.test(k)) {continue;}
      values.push(v);
    }
    // Longest-first so a shorter secret that is a substring of a longer
    // one doesn't leave the longer one's tail unredacted.
    values.sort((a, b) => b.length - a.length);
    for (const v of values) {
      if (!out.includes(v)) {continue;}
      out = out.split(v).join(`[REDACTED:${digest8(v)}]`);
    }
  }
  return out;
}

/** Fresh fake logger — dumpFailure only ever calls `.error`. */
function makeLog() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/** The markdown handed to `appendFileSync` for the job summary. */
function writtenSummary(): string {
  const calls = vi.mocked(appendFileSync).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return String(calls[calls.length - 1]?.[1]);
}

const ENV_BAK = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(redact).mockImplementation(faithfulRedact);
  // A truthy path so `writeSummary` reaches `appendFileSync`; no real
  // file is touched (fs is mocked). Bare basename — no separator, so
  // nothing here is OS-specific.
  process.env.GITHUB_STEP_SUMMARY = 'summary.md';
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ENV_BAK)) {delete process.env[k];}
  }
  Object.assign(process.env, ENV_BAK);
});

function baseCtx(over: Partial<FailureContext> = {}): FailureContext {
  return {
    package: 'demo',
    handler: 'crates',
    command: ['cargo', 'publish'],
    stdout: 'some output',
    stderr: 'some error',
    exitCode: 1,
    toolVersions: { cargo: 'cargo 1.78.0' },
    ...over,
  };
}

describe('dumpFailure: GitHub step summary', () => {
  it('writes a markdown report to $GITHUB_STEP_SUMMARY', () => {
    const log = makeLog();
    dumpFailure(new Error('publish failed'), baseCtx(), { log });
    const md = writtenSummary();
    expect(md).toContain('publish failed');
    expect(md).toContain('demo');
    expect(md).toContain('crates');
    expect(md).toContain('cargo publish');
    expect(md).toContain('some output');
    expect(md).toContain('some error');
    expect(md).toContain('cargo 1.78.0');
  });

  it('no-ops when $GITHUB_STEP_SUMMARY is unset', () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    const log = makeLog();
    // Should not throw, and should not write the summary.
    dumpFailure(new Error('nope'), baseCtx(), { log });
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it('includes handler-specific extras when supplied', () => {
    const log = makeLog();
    dumpFailure(new Error('fail'), baseCtx({ extras: { wheelTags: ['cp310-linux'] } }), { log });
    const md = writtenSummary();
    expect(md).toContain('wheelTags');
    expect(md).toContain('cp310-linux');
  });
});

describe('dumpFailure: empty streams', () => {
  it('renders "(empty)" for missing stdout/stderr', () => {
    const log = makeLog();
    dumpFailure(new Error('blank'), baseCtx({ stdout: '', stderr: '' }), { log });
    const md = writtenSummary();
    expect(md).toContain('(empty)');
  });

  it('omits the tool-versions block when no versions supplied', () => {
    const log = makeLog();
    dumpFailure(new Error('no-versions'), baseCtx({ toolVersions: {} }), { log });
    const md = writtenSummary();
    expect(md).not.toContain('Tool versions');
  });
});

describe('dumpFailure: structured log', () => {
  it('emits a single error-level record summarizing the failure', () => {
    const log = makeLog();
    dumpFailure(new Error('boom'), baseCtx(), { log });
    // Exactly one error-level record; no other level was emitted.
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.debug).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    const [msg, fields] = log.error.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toContain('boom');
    expect(fields.package).toBe('demo');
    expect(fields.handler).toBe('crates');
    expect(fields.exitCode).toBe(1);
  });
});

describe('dumpFailure: redaction', () => {
  it('redacts env-matched secrets from stderr before writing', () => {
    process.env.CARGO_REGISTRY_TOKEN = 'tok-abc-123';
    const log = makeLog();
    dumpFailure(
      new Error('auth'),
      baseCtx({ stderr: 'sent token tok-abc-123 in header' }),
      { log },
    );
    const md = writtenSummary();
    expect(md).not.toContain('tok-abc-123');
    expect(md).toMatch(/\[REDACTED:[0-9a-f]{8}\]/);
  });

  it('redacts secrets from stdout too', () => {
    process.env.NPM_SECRET = 'super-secret-xyz';
    const log = makeLog();
    dumpFailure(new Error('x'), baseCtx({ stdout: 'super-secret-xyz' }), { log });
    const md = writtenSummary();
    expect(md).not.toContain('super-secret-xyz');
  });

  it('redacts secrets that live ONLY on a passed envSource (ctx.env), not process.env (#195)', () => {
    // The handler-injected credential case: an OIDC-minted twine or npm
    // token that's put on ctx.env but never touches process.env. Without
    // the envSources passthrough, the job-summary markdown leaks the
    // value even though the structured log record (which uses the logger
    // built with the same env) does not.
    const ctxEnv: Record<string, string> = {
      CARGO_REGISTRY_TOKEN: 'ctx-only-abcdef1234',
    };
    // Sanity: process.env does NOT have this token.
    expect(process.env.CARGO_REGISTRY_TOKEN).toBeUndefined();
    const log = makeLog();
    dumpFailure(
      new Error('handler failed'),
      baseCtx({ stderr: 'used token ctx-only-abcdef1234 from ctx.env' }),
      { log, envSources: [ctxEnv] },
    );
    const md = writtenSummary();
    expect(md).not.toContain('ctx-only-abcdef1234');
    expect(md).toMatch(/\[REDACTED:[0-9a-f]{8}\]/);
  });

  it('still redacts process.env secrets when an envSource is also supplied', () => {
    process.env.NPM_TOKEN = 'proc-tok-xxxxxxxx';
    const ctxEnv: Record<string, string> = { PYPI_API_TOKEN: 'ctx-pypi-yyyyyyyy' };
    const log = makeLog();
    dumpFailure(
      new Error('both'),
      baseCtx({ stderr: 'proc-tok-xxxxxxxx and ctx-pypi-yyyyyyyy both appear' }),
      { log, envSources: [ctxEnv] },
    );
    const md = writtenSummary();
    expect(md).not.toContain('proc-tok-xxxxxxxx');
    expect(md).not.toContain('ctx-pypi-yyyyyyyy');
  });
});

// Phase 3 / Idea 6. The job-summary markdown ($GITHUB_STEP_SUMMARY) is
// auth-gated on private repos and not always visible to a foreign agent
// helping debug from outside. GitHub workflow-command annotations
// emitted via stdout (`::error::…`) DO render on the public run-summary
// page, so the failure surface is reachable without auth. Carry the
// error code + handler/package + first error line.
describe('dumpFailure: GHA workflow-command annotation', () => {
  let stdoutWrites: string[] = [];
  let restoreWrite: (() => void) | undefined;

  beforeEach(() => {
    stdoutWrites = [];
    const original = process.stdout.write.bind(process.stdout);
    // Replace with a capturer that records the chunk and returns true.
    // We don't need to forward to the real stream — the dumpFailure
    // tests only check that ::error:: lines are emitted.
    process.stdout.write = (chunk) => {
      const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      stdoutWrites.push(s);
      return true;
    };
    restoreWrite = () => {
      process.stdout.write = original;
    };
    process.env.GITHUB_ACTIONS = 'true';
  });

  afterEach(() => {
    restoreWrite?.();
    delete process.env.GITHUB_ACTIONS;
  });

  it('emits a single ::error:: annotation when running in GHA', () => {
    const log = makeLog();
    dumpFailure(new Error('publish failed'), baseCtx(), { log });
    const annotations = stdoutWrites.filter((s) => s.startsWith('::error::'));
    expect(annotations).toHaveLength(1);
  });

  it('annotation tags handler/package and includes the first message line', () => {
    const log = makeLog();
    dumpFailure(new Error('publish failed: 401 unauthorized'), baseCtx(), { log });
    const line = stdoutWrites.find((s) => s.startsWith('::error::')) ?? '';
    expect(line).toContain('crates/demo');
    expect(line).toContain('401 unauthorized');
  });

  it('annotation includes the PIOT_ error code when present in the error message', () => {
    // Registry handlers may tag their auth-failure error message with
    // a `[PIOT_*]` code; the annotation should surface the bracketed
    // code so external observers can fingerprint on it without needing
    // to read the full markdown.
    const log = makeLog();
    dumpFailure(
      new Error('pypi: no auth available [PIOT_AUTH_NO_TOKEN]'),
      baseCtx({ handler: 'pypi', package: 'demo-pkg' }),
      { log },
    );
    const line = stdoutWrites.find((s) => s.startsWith('::error::')) ?? '';
    expect(line).toContain('PIOT_AUTH_NO_TOKEN');
  });

  it('redacts env-matched secrets from the annotation body', () => {
    process.env.PYPI_API_TOKEN = 'pypi-tok-zzz';
    const log = makeLog();
    dumpFailure(
      new Error('publish: leaked pypi-tok-zzz'),
      baseCtx(),
      { log },
    );
    const line = stdoutWrites.find((s) => s.startsWith('::error::')) ?? '';
    expect(line).not.toContain('pypi-tok-zzz');
  });

  it('no-ops outside GitHub Actions', () => {
    delete process.env.GITHUB_ACTIONS;
    const log = makeLog();
    dumpFailure(new Error('local run'), baseCtx(), { log });
    const annotations = stdoutWrites.filter((s) => s.startsWith('::error::'));
    expect(annotations).toEqual([]);
  });

  it('emits an annotation even when the message has no non-empty line', () => {
    // A message that is only blank lines makes `.find` return undefined,
    // exercising the `?? ''` fallback for the first-line selection.
    const log = makeLog();
    dumpFailure(new Error('\n   \n\t\n'), baseCtx(), { log });
    const annotations = stdoutWrites.filter((s) => s.startsWith('::error::'));
    expect(annotations).toHaveLength(1);
    // Header (handler/package) is still present; body first-line is empty.
    expect(annotations[0]).toContain('crates/demo');
  });

  it('truncates an over-length annotation with an ellipsis', () => {
    // A message far longer than the 500-char cap forces the slice branch of
    // the length guard, appending the single-char ellipsis.
    const log = makeLog();
    dumpFailure(new Error('x'.repeat(2000)), baseCtx(), { log });
    const line = stdoutWrites.find((s) => s.startsWith('::error::')) ?? '';
    const body = line.slice('::error::'.length, -1); // strip prefix + terminator
    expect(body.length).toBe(500);
    expect(body.endsWith('…')).toBe(true);
  });

  it('keeps the annotation to a single line (encodes embedded newlines)', () => {
    // GitHub annotations are line-oriented; an embedded newline would
    // truncate the annotation at the break point. The dumpFailure
    // implementation must collapse to one line (either by encoding
    // %0A or by taking the first line only).
    const log = makeLog();
    dumpFailure(
      new Error('first line\nsecond line\nthird line'),
      baseCtx(),
      { log },
    );
    const line = stdoutWrites.find((s) => s.startsWith('::error::')) ?? '';
    // Exactly one trailing newline (the line terminator), no embedded
    // bare newlines in the annotation body itself.
    expect(line.endsWith('\n')).toBe(true);
    const body = line.slice(0, -1); // strip terminator
    expect(body).not.toContain('\n');
  });
});

describe('dumpFailure: size cap (4MB)', () => {
  it('truncates oversized stdout and notes the truncation', () => {
    const big = 'x'.repeat(5 * 1024 * 1024);
    const log = makeLog();
    dumpFailure(new Error('huge'), baseCtx({ stdout: big }), { log });
    const md = writtenSummary();
    expect(md.length).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(md).toMatch(/truncated/i);
  });
});
