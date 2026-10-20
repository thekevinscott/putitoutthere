/**
 * Verbose-on-failure dump tests (#15). `./redact.js` is automocked but the pure
 * `redact` helper is restored with a tiny faithful reimplementation, so the
 * redaction contract is still exercised against the fake logger.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { redact } from './redact.js';
import { truncateSummary } from './truncate-summary.js';
import { dumpFailure } from './verbose.js';
import type { FailureContext } from './verbose-types.js';
import { writeSummary } from './write-summary.js';

vi.mock('./redact.js');
vi.mock('./truncate-summary.js');
vi.mock('./write-summary.js');

/**
 * Credential-shaped env-var matcher — copied from `scan-source.ts` so the mocked
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

/** Tiny faithful reimplementation of `redact.ts#redact` (see module note). */
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

/** The markdown handed to `writeSummary` for the job summary. */
function writtenSummary(): string {
  const calls = vi.mocked(writeSummary).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]?.[0] as string;
}

const ENV_BAK = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(redact).mockImplementation(faithfulRedact);
  vi.mocked(truncateSummary).mockImplementation((md) => md);
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
  it('writes a markdown report to $GITHUB_STEP_SUMMARY', async () => {
    const log = makeLog();
    await dumpFailure(new Error('publish failed'), baseCtx(), { log });
    const md = writtenSummary();
    expect(md).toContain('publish failed');
    expect(md).toContain('demo');
    expect(md).toContain('crates');
    expect(md).toContain('cargo publish');
    expect(md).toContain('some output');
    expect(md).toContain('some error');
    expect(md).toContain('cargo 1.78.0');
  });

  it('includes handler-specific extras when supplied', async () => {
    const log = makeLog();
    await dumpFailure(new Error('fail'), baseCtx({ extras: { wheelTags: ['cp310-linux'] } }), { log });
    const md = writtenSummary();
    expect(md).toContain('wheelTags');
    expect(md).toContain('cp310-linux');
  });
});

describe('dumpFailure: empty streams', () => {
  it('renders "(empty)" for missing stdout/stderr', async () => {
    const log = makeLog();
    await dumpFailure(new Error('blank'), baseCtx({ stdout: '', stderr: '' }), { log });
    const md = writtenSummary();
    expect(md).toContain('(empty)');
  });

  it('omits the tool-versions block when no versions supplied', async () => {
    const log = makeLog();
    await dumpFailure(new Error('no-versions'), baseCtx({ toolVersions: {} }), { log });
    const md = writtenSummary();
    expect(md).not.toContain('Tool versions');
  });
});

describe('dumpFailure: structured log', () => {
  it('emits a single error-level record summarizing the failure', async () => {
    const log = makeLog();
    await dumpFailure(new Error('boom'), baseCtx(), { log });
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
  it('redacts env-matched secrets from stderr before writing', async () => {
    process.env.CARGO_REGISTRY_TOKEN = 'tok-abc-123';
    const log = makeLog();
    await dumpFailure(
      new Error('auth'),
      baseCtx({ stderr: 'sent token tok-abc-123 in header' }),
      { log },
    );
    const md = writtenSummary();
    expect(md).not.toContain('tok-abc-123');
    expect(md).toMatch(/\[REDACTED:[0-9a-f]{8}\]/);
  });

  it('redacts secrets from stdout too', async () => {
    process.env.NPM_SECRET = 'super-secret-xyz';
    const log = makeLog();
    await dumpFailure(new Error('x'), baseCtx({ stdout: 'super-secret-xyz' }), { log });
    const md = writtenSummary();
    expect(md).not.toContain('super-secret-xyz');
  });

  it('redacts secrets that live ONLY on a passed envSource (ctx.env), not process.env (#195)', async () => {
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
    await dumpFailure(
      new Error('handler failed'),
      baseCtx({ stderr: 'used token ctx-only-abcdef1234 from ctx.env' }),
      { log, envSources: [ctxEnv] },
    );
    const md = writtenSummary();
    expect(md).not.toContain('ctx-only-abcdef1234');
    expect(md).toMatch(/\[REDACTED:[0-9a-f]{8}\]/);
  });

  it('still redacts process.env secrets when an envSource is also supplied', async () => {
    process.env.NPM_TOKEN = 'proc-tok-xxxxxxxx';
    const ctxEnv: Record<string, string> = { PYPI_API_TOKEN: 'ctx-pypi-yyyyyyyy' };
    const log = makeLog();
    await dumpFailure(
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

  it('emits a single ::error:: annotation when running in GHA', async () => {
    const log = makeLog();
    await dumpFailure(new Error('publish failed'), baseCtx(), { log });
    const annotations = stdoutWrites.filter((s) => s.startsWith('::error::'));
    expect(annotations).toHaveLength(1);
  });

  it('annotation tags handler/package and includes the first message line', async () => {
    const log = makeLog();
    await dumpFailure(new Error('publish failed: 401 unauthorized'), baseCtx(), { log });
    const line = stdoutWrites.find((s) => s.startsWith('::error::')) ?? '';
    expect(line).toContain('crates/demo');
    expect(line).toContain('401 unauthorized');
  });

  it('redacts env-matched secrets from the annotation body', async () => {
    process.env.PYPI_API_TOKEN = 'pypi-tok-zzz';
    const log = makeLog();
    await dumpFailure(
      new Error('publish: leaked pypi-tok-zzz'),
      baseCtx(),
      { log },
    );
    const line = stdoutWrites.find((s) => s.startsWith('::error::')) ?? '';
    expect(line).not.toContain('pypi-tok-zzz');
  });
});

describe('dumpFailure: size cap', () => {
  it('writes the truncated redacted summary, not the raw one', async () => {
    process.env.NPM_SECRET = 'super-secret-xyz';
    vi.mocked(truncateSummary).mockReturnValue('truncated-md');
    const log = makeLog();
    await dumpFailure(new Error('huge'), baseCtx({ stdout: 'big super-secret-xyz' }), { log });
    const truncated = vi.mocked(truncateSummary).mock.calls[0]?.[0];
    expect(truncated).toContain('big [REDACTED:');
    expect(truncated).not.toContain('super-secret-xyz');
    expect(writeSummary).toHaveBeenCalledWith('truncated-md');
  });
});
