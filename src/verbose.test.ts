/**
 * Verbose-on-failure dump tests.
 *
 * Plan: §22.4.
 * Issue #15.
 */

import { Writable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dumpFailure, type FailureContext } from './verbose.js';
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
let tmpDir: string;
let summaryPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'putitoutthere-verbose-'));
  summaryPath = join(tmpDir, 'summary.md');
  process.env.GITHUB_STEP_SUMMARY = summaryPath;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) {
    if (!(k in ENV_BAK)) delete process.env[k];
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
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    dumpFailure(new Error('publish failed'), baseCtx(), { log });
    const md = readFileSync(summaryPath, 'utf8');
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
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    // Should not throw, and should not create the file.
    dumpFailure(new Error('nope'), baseCtx(), { log });
    expect(() => readFileSync(summaryPath, 'utf8')).toThrow();
  });

  it('includes handler-specific extras when supplied', () => {
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    dumpFailure(new Error('fail'), baseCtx({ extras: { wheelTags: ['cp310-linux'] } }), { log });
    const md = readFileSync(summaryPath, 'utf8');
    expect(md).toContain('wheelTags');
    expect(md).toContain('cp310-linux');
  });
});

describe('dumpFailure: empty streams', () => {
  it('renders "(empty)" for missing stdout/stderr', () => {
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    dumpFailure(new Error('blank'), baseCtx({ stdout: '', stderr: '' }), { log });
    const md = readFileSync(summaryPath, 'utf8');
    expect(md).toContain('(empty)');
  });

  it('omits the tool-versions block when no versions supplied', () => {
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    dumpFailure(new Error('no-versions'), baseCtx({ toolVersions: {} }), { log });
    const md = readFileSync(summaryPath, 'utf8');
    expect(md).not.toContain('Tool versions');
  });
});

describe('dumpFailure: structured log', () => {
  it('emits a single error-level record summarizing the failure', () => {
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    dumpFailure(new Error('boom'), baseCtx(), { log });
    const line = logDest.text.trim();
    const record = JSON.parse(line) as Record<string, unknown>;
    expect(record.level).toBe('error');
    expect(record.package).toBe('demo');
    expect(record.handler).toBe('crates');
    expect(record.exitCode).toBe(1);
    expect(record.msg).toContain('boom');
  });
});

describe('dumpFailure: redaction', () => {
  it('redacts env-matched secrets from stderr before writing', () => {
    process.env.CARGO_REGISTRY_TOKEN = 'tok-abc-123';
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    dumpFailure(
      new Error('auth'),
      baseCtx({ stderr: 'sent token tok-abc-123 in header' }),
      { log },
    );
    const md = readFileSync(summaryPath, 'utf8');
    expect(md).not.toContain('tok-abc-123');
    expect(md).toMatch(/\[REDACTED:[0-9a-f]{8}\]/);
  });

  it('redacts secrets from stdout too', () => {
    process.env.NPM_SECRET = 'super-secret-xyz';
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    dumpFailure(new Error('x'), baseCtx({ stdout: 'super-secret-xyz' }), { log });
    const md = readFileSync(summaryPath, 'utf8');
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
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    dumpFailure(
      new Error('handler failed'),
      baseCtx({ stderr: 'used token ctx-only-abcdef1234 from ctx.env' }),
      { log, envSources: [ctxEnv] },
    );
    const md = readFileSync(summaryPath, 'utf8');
    expect(md).not.toContain('ctx-only-abcdef1234');
    expect(md).toMatch(/\[REDACTED:[0-9a-f]{8}\]/);
  });

  it('still redacts process.env secrets when an envSource is also supplied', () => {
    process.env.NPM_TOKEN = 'proc-tok-xxxxxxxx';
    const ctxEnv: Record<string, string> = { PYPI_API_TOKEN: 'ctx-pypi-yyyyyyyy' };
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    dumpFailure(
      new Error('both'),
      baseCtx({ stderr: 'proc-tok-xxxxxxxx and ctx-pypi-yyyyyyyy both appear' }),
      { log, envSources: [ctxEnv] },
    );
    const md = readFileSync(summaryPath, 'utf8');
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
  let restore: (() => void) | undefined;

  beforeEach(() => {
    stdoutWrites = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // Spy that captures writes but still forwards to the real stream so
    // vitest's reporter output isn't disturbed.
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      stdoutWrites.push(s);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      return origWrite(chunk as any, ...(rest as any));
    }) as typeof process.stdout.write;
    restore = () => {
      process.stdout.write = origWrite;
    };
    process.env.GITHUB_ACTIONS = 'true';
  });

  afterEach(() => {
    restore?.();
    delete process.env.GITHUB_ACTIONS;
  });

  it('emits a single ::error:: annotation when running in GHA', () => {
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    dumpFailure(new Error('publish failed'), baseCtx(), { log });
    const annotations = stdoutWrites.filter((s) => s.startsWith('::error::'));
    expect(annotations).toHaveLength(1);
  });

  it('annotation tags handler/package and includes the first message line', () => {
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    dumpFailure(new Error('publish failed: 401 unauthorized'), baseCtx(), { log });
    const line = stdoutWrites.find((s) => s.startsWith('::error::')) ?? '';
    expect(line).toContain('crates/demo');
    expect(line).toContain('401 unauthorized');
  });

  it('annotation includes the PIOT_ error code when present in the error message', () => {
    // The auth-failure error from `renderAuthFailure` prefixes its
    // first line with `[PIOT_AUTH_NO_TOKEN]`; the annotation should
    // surface the bracketed code so external observers can fingerprint
    // on it without needing to read the full markdown.
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
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
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
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
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    dumpFailure(new Error('local run'), baseCtx(), { log });
    const annotations = stdoutWrites.filter((s) => s.startsWith('::error::'));
    expect(annotations).toEqual([]);
  });

  it('keeps the annotation to a single line (encodes embedded newlines)', () => {
    // GitHub annotations are line-oriented; an embedded newline would
    // truncate the annotation at the break point. The dumpFailure
    // implementation must collapse to one line (either by encoding
    // %0A or by taking the first line only).
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
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
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    dumpFailure(new Error('huge'), baseCtx({ stdout: big }), { log });
    const md = readFileSync(summaryPath, 'utf8');
    expect(md.length).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(md).toMatch(/truncated/i);
  });
});
