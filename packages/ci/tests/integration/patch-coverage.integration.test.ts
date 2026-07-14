/**
 * Integration test for the patch-coverage gate (#468, epic #442).
 *
 * Drives the real `piot-ci patch-coverage` dispatch in-process — `run()` from
 * `cli.ts` → `runPatchCoverage` → the real parseAddedLines / coveredLines /
 * decidePatchCoverage — with only the git-subprocess (`node:child_process`)
 * and file-read (`node:fs`) boundaries mocked. Unlike
 * `src/patch-coverage/run.test.ts` (which mocks the decision modules to isolate
 * the composition root's wiring), this exercises the real strict-100% /
 * no-escape-hatch decision end to end: the no-additions pass, the clean pass,
 * the uncovered `::error`, and the escape-hatch `::error`, all asserted through
 * the actual command and streams.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

vi.mock('node:child_process');
vi.mock('node:fs');

const exec = vi.mocked(execFileSync);
const readFile = vi.mocked(readFileSync);
let out: string[];
let err: string[];
const cwd = process.cwd();
const covKey = (rel: string): string => `${cwd}/${rel}`;

// git cat-file probes succeed; `git diff` returns the supplied post-image.
function git(diffOut: string): void {
  exec.mockImplementation((_cmd, args) => {
    const a = (args as readonly string[]) ?? [];
    return a.includes('cat-file') ? '' : diffOut;
  });
}

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    err.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  process.env.BASE_SHA = 'base';
  process.env.HEAD_SHA = 'head';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BASE_SHA;
  delete process.env.HEAD_SHA;
});

const patchCoverage = (): number => run(['node', 'piot-ci', 'patch-coverage']);

const diffAdding = (rel: string, startLine: number, text: string): string =>
  [`+++ ${rel}`, `@@ -0,0 +${startLine},1 @@`, `+${text}`, ''].join('\n');

describe('piot-ci patch-coverage (integration)', () => {
  it('passes without reading coverage when the diff adds no src lines', () => {
    git(['+++ README.md', '@@ -0,0 +1,1 @@', '+hello', ''].join('\n'));
    expect(patchCoverage()).toBe(0);
    expect(out.join('')).toBe('patch-coverage: no src/**/*.ts additions in this PR; passing.\n');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('passes when every added engine src line is covered', () => {
    git(diffAdding('packages/engine/src/foo.ts', 5, 'const x = 1;'));
    readFile.mockReturnValue(
      JSON.stringify({
        [covKey('packages/engine/src/foo.ts')]: {
          s: { '0': 1 },
          statementMap: { '0': { start: { line: 5 }, end: { line: 5 } } },
        },
      }),
    );
    expect(patchCoverage()).toBe(0);
    expect(out.join('')).toBe('patch-coverage: every added src/ line is covered, no escape hatches. ✓\n');
  });

  it('fails, naming the uncovered added line, when coverage shows it never ran', () => {
    git(diffAdding('packages/engine/src/foo.ts', 5, 'const x = 1;'));
    readFile.mockReturnValue(
      JSON.stringify({
        [covKey('packages/engine/src/foo.ts')]: {
          s: { '0': 0 },
          statementMap: { '0': { start: { line: 5 }, end: { line: 5 } } },
        },
      }),
    );
    expect(patchCoverage()).toBe(1);
    expect(err.join('')).toBe(
      [
        'patch-coverage: violations found.',
        '',
        'Strict 100% on new src/ code; no `/* v8 ignore */` escape hatches.',
        'Add a unit test that exercises each new line listed below, or restructure',
        'the new code so it sits on an already-tested path.',
        '',
        '::error file=packages/engine/src/foo.ts,line=5::patch-coverage [uncovered] added line not exercised by unit tests: const x = 1;',
        '',
        '1 violation(s).',
        '',
      ].join('\n'),
    );
  });

  it('fails when the added line introduces a v8 ignore escape hatch, even if covered', () => {
    git(diffAdding('packages/engine/src/foo.ts', 5, '/* v8 ignore next */'));
    readFile.mockReturnValue(
      JSON.stringify({
        [covKey('packages/engine/src/foo.ts')]: {
          s: { '0': 1 },
          statementMap: { '0': { start: { line: 5 }, end: { line: 5 } } },
        },
      }),
    );
    expect(patchCoverage()).toBe(1);
    expect(err.join('')).toContain(
      '::error file=packages/engine/src/foo.ts,line=5::patch-coverage [escape-hatch] new ignore marker introduced: /* v8 ignore next */',
    );
  });

  it('fails with exit 2 when BASE_SHA / HEAD_SHA are unset', () => {
    delete process.env.BASE_SHA;
    delete process.env.HEAD_SHA;
    expect(patchCoverage()).toBe(2);
    expect(err.join('')).toBe('::error::patch-coverage: BASE_SHA and HEAD_SHA must be set\n');
  });

  it('fails with exit 2 when a SHA is unreachable in the clone', () => {
    exec.mockImplementation(() => {
      throw new Error('bad object');
    });
    expect(patchCoverage()).toBe(2);
    expect(err.join('')).toBe('::error::patch-coverage: base or head not reachable in this clone\n');
  });
});
