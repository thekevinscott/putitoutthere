/**
 * Composition-root coverage for the patch-coverage gate (#468). The decision
 * modules (parseAddedLines, coveredLines, decidePatchCoverage) and the I/O
 * boundary (node:child_process, node:fs) are mocked, so this isolates run's
 * wiring: the env guard, the SHA-reachability `git cat-file` probes, the exact
 * `git diff` invocation (with its `maxBuffer`), how the diff is fed to
 * parseAddedLines, the conditional coverage read (skipped when there are no
 * additions), the cwd-relative coverage key resolution, the read-failure
 * guard, and how decide()'s out/err lines + exit code surface to the two
 * streams. The decisions themselves live in their own tests.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { coveredLines } from './covered-lines.js';
import { decidePatchCoverage } from './decide.js';
import { parseAddedLines } from './parse-added-lines.js';
import { runPatchCoverage } from './run.js';

vi.mock('node:child_process');
vi.mock('node:fs');
vi.mock('./covered-lines.js');
vi.mock('./decide.js');
vi.mock('./parse-added-lines.js');

const exec = vi.mocked(execFileSync);
const readFile = vi.mocked(readFileSync);
const parse = vi.mocked(parseAddedLines);
const covered = vi.mocked(coveredLines);
const decide = vi.mocked(decidePatchCoverage);

const out: string[] = [];
const err: string[] = [];
const cwd = process.cwd();
const COV_PATH = `${cwd}/packages/engine/coverage/coverage-final.json`;

// Route git by subcommand: cat-file probes return nothing, diff returns text.
function routeGit(diffOut: string): void {
  exec.mockImplementation((_cmd, args) => {
    const a = (args as readonly string[]) ?? [];
    if (a.includes('cat-file')) {
      return '';
    }
    return diffOut;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  err.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    err.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  process.env.BASE_SHA = 'aaaa';
  process.env.HEAD_SHA = 'bbbb';
  parse.mockReturnValue([]);
  decide.mockReturnValue({ exitCode: 0, out: [], err: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BASE_SHA;
  delete process.env.HEAD_SHA;
});

describe('runPatchCoverage: env guard', () => {
  it('fails with exit 2 and never shells out when BASE_SHA is absent', () => {
    delete process.env.BASE_SHA;
    const code = runPatchCoverage();
    expect(code).toBe(2);
    expect(err.join('')).toBe('::error::patch-coverage: BASE_SHA and HEAD_SHA must be set\n');
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails with exit 2 when BASE_SHA is the empty string', () => {
    process.env.BASE_SHA = '';
    expect(runPatchCoverage()).toBe(2);
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails with exit 2 when HEAD_SHA is absent', () => {
    delete process.env.HEAD_SHA;
    expect(runPatchCoverage()).toBe(2);
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails with exit 2 when HEAD_SHA is the empty string', () => {
    process.env.HEAD_SHA = '';
    expect(runPatchCoverage()).toBe(2);
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('runPatchCoverage: SHA reachability', () => {
  it('probes both SHAs with git cat-file -e before diffing', () => {
    routeGit('');
    runPatchCoverage();
    expect(exec).toHaveBeenNthCalledWith(1, 'git', ['cat-file', '-e', 'aaaa'], { stdio: 'ignore' });
    expect(exec).toHaveBeenNthCalledWith(2, 'git', ['cat-file', '-e', 'bbbb'], { stdio: 'ignore' });
  });

  it('fails with exit 2 and the unreachable message when a probe throws', () => {
    exec.mockImplementation(() => {
      throw new Error('bad object');
    });
    const code = runPatchCoverage();
    expect(code).toBe(2);
    expect(err.join('')).toBe('::error::patch-coverage: aaaa or bbbb not reachable in this clone\n');
    expect(parse).not.toHaveBeenCalled();
  });
});

describe('runPatchCoverage: git diff', () => {
  it('runs the exact rename-aware unified=0 diff with a generous maxBuffer', () => {
    routeGit('DIFF');
    runPatchCoverage();
    expect(exec).toHaveBeenNthCalledWith(3, 'git', ['diff', '--unified=0', '--no-prefix', '-M', 'aaaa..bbbb'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  });

  it('feeds the raw diff output to parseAddedLines', () => {
    routeGit('DIFF-TEXT');
    runPatchCoverage();
    expect(parse).toHaveBeenCalledWith('DIFF-TEXT');
  });
});

describe('runPatchCoverage: coverage read gating', () => {
  it('does NOT read the coverage file when there are no added lines', () => {
    routeGit('');
    parse.mockReturnValue([]);
    runPatchCoverage();
    expect(readFile).not.toHaveBeenCalled();
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ addedByFile: [] }));
  });

  it('reads the cwd-relative coverage-final.json when there are added lines', () => {
    routeGit('');
    parse.mockReturnValue([{ file: 'packages/engine/src/foo.ts', added: [{ line: 1, text: 'x' }] }]);
    readFile.mockReturnValue('{}');
    runPatchCoverage();
    expect(readFile).toHaveBeenCalledWith(COV_PATH, 'utf8');
  });

  it('fails with exit 2 and the covPath message when the coverage read throws', () => {
    routeGit('');
    parse.mockReturnValue([{ file: 'packages/engine/src/foo.ts', added: [{ line: 1, text: 'x' }] }]);
    readFile.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const code = runPatchCoverage();
    expect(code).toBe(2);
    expect(err.join('')).toBe(`::error::patch-coverage: cannot read ${COV_PATH}: ENOENT\n`);
    expect(decide).not.toHaveBeenCalled();
  });
});

describe('runPatchCoverage: coverageFor wiring', () => {
  it('resolves a file to its cwd-absolute coverage record via coveredLines', () => {
    routeGit('');
    parse.mockReturnValue([{ file: 'packages/engine/src/foo.ts', added: [{ line: 1, text: 'x' }] }]);
    const record = { s: { '0': 1 }, statementMap: { '0': { start: { line: 1 }, end: { line: 1 } } } };
    readFile.mockReturnValue(JSON.stringify({ [`${cwd}/packages/engine/src/foo.ts`]: record }));
    covered.mockReturnValue({ covered: new Set([1]), uncovered: new Set() });

    runPatchCoverage();
    const input = decide.mock.calls[0]![0];
    const result = input.coverageFor('packages/engine/src/foo.ts');
    expect(covered).toHaveBeenCalledWith(record);
    expect(result).toEqual({ covered: new Set([1]), uncovered: new Set() });
  });

  it('passes undefined to coveredLines for a file with no coverage record', () => {
    routeGit('');
    parse.mockReturnValue([{ file: 'packages/engine/src/foo.ts', added: [{ line: 1, text: 'x' }] }]);
    readFile.mockReturnValue('{}');
    covered.mockReturnValue(null);

    runPatchCoverage();
    const input = decide.mock.calls[0]![0];
    input.coverageFor('packages/engine/src/missing.ts');
    expect(covered).toHaveBeenCalledWith(undefined);
  });
});

describe('runPatchCoverage: output surfacing', () => {
  it('writes decide()’s out lines to stdout, err lines to stderr, and returns its exit code', () => {
    routeGit('');
    decide.mockReturnValue({ exitCode: 1, out: ['ok note'], err: ['::error boom', 'tail'] });
    const code = runPatchCoverage();
    expect(code).toBe(1);
    expect(out.join('')).toBe('ok note\n');
    expect(err.join('')).toBe('::error boom\ntail\n');
  });

  it('returns 0 and writes only the pass line for a clean decide result', () => {
    routeGit('');
    decide.mockReturnValue({ exitCode: 0, out: ['all good'], err: [] });
    expect(runPatchCoverage()).toBe(0);
    expect(out.join('')).toBe('all good\n');
    expect(err.join('')).toBe('');
  });
});
