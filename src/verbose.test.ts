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
    process.env.CARGO_REGISTRY_TOKEN = 'long-tok-abc-123';
    const logDest = new BufStream();
    const log = createLogger({ stream: logDest, pretty: false });
    dumpFailure(
      new Error('auth'),
      baseCtx({ stderr: 'sent token long-tok-abc-123 in header' }),
      { log },
    );
    const md = readFileSync(summaryPath, 'utf8');
    expect(md).not.toContain('long-tok-abc-123');
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
