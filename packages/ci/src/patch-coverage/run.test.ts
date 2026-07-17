/**
 * Composition-root coverage for the patch-coverage gate (#468). The decision
 * modules (parseAddedLines, coveredLines, decidePatchCoverage) and the I/O
 * boundary (the exec seam, node:fs/promises) are mocked, so this isolates run's
 * wiring: the env guard, the SHA-reachability `git cat-file` probes, the exact
 * `git diff` invocation (with its `maxBuffer`), how the diff is fed to
 * parseAddedLines, the conditional coverage read (skipped when there are no
 * additions), the cwd-relative coverage key resolution, the read-failure
 * guard, and how decide()'s out/err lines + exit code surface to the two
 * streams. The decisions themselves live in their own tests.
 */

import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture } from '../utils/exec-capture.js';
import { coveredLines } from './covered-lines.js';
import { decidePatchCoverage } from './decide.js';
import { parseAddedLines } from './parse-added-lines.js';
import { runPatchCoverage } from './run.js';

vi.mock('../utils/exec-capture.js');
vi.mock('node:fs/promises');
vi.mock('./covered-lines.js');
vi.mock('./decide.js');
vi.mock('./parse-added-lines.js');

const exec = vi.mocked(execCapture);
const readFileMock = vi.mocked(readFile);
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
    const a = args ?? [];
    if (a.includes('cat-file')) {
      return Promise.resolve({ stdout: '', stderr: '' });
    }
    return Promise.resolve({ stdout: diffOut, stderr: '' });
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
  it('fails with exit 2 and never shells out when BASE_SHA is absent', async () => {
    delete process.env.BASE_SHA;
    const code = await runPatchCoverage();
    expect(code).toBe(2);
    expect(err.join('')).toBe('::error::patch-coverage: BASE_SHA and HEAD_SHA must be set\n');
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails with exit 2 when BASE_SHA is the empty string', async () => {
    process.env.BASE_SHA = '';
    await expect(runPatchCoverage()).resolves.toBe(2);
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails with exit 2 when HEAD_SHA is absent', async () => {
    delete process.env.HEAD_SHA;
    await expect(runPatchCoverage()).resolves.toBe(2);
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails with exit 2 when HEAD_SHA is the empty string', async () => {
    process.env.HEAD_SHA = '';
    await expect(runPatchCoverage()).resolves.toBe(2);
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('runPatchCoverage: SHA reachability', () => {
  it('probes both SHAs with git cat-file -e before diffing', async () => {
    routeGit('');
    await runPatchCoverage();
    expect(exec).toHaveBeenNthCalledWith(1, 'git', ['cat-file', '-e', 'aaaa']);
    expect(exec).toHaveBeenNthCalledWith(2, 'git', ['cat-file', '-e', 'bbbb']);
  });

  it('fails with exit 2 and the unreachable message when a probe throws', async () => {
    exec.mockRejectedValue(new Error('bad object'));
    const code = await runPatchCoverage();
    expect(code).toBe(2);
    expect(err.join('')).toBe('::error::patch-coverage: aaaa or bbbb not reachable in this clone\n');
    expect(parse).not.toHaveBeenCalled();
  });
});

describe('runPatchCoverage: git diff', () => {
  it('runs the exact rename-aware unified=0 diff with a generous maxBuffer', async () => {
    routeGit('DIFF');
    await runPatchCoverage();
    expect(exec).toHaveBeenNthCalledWith(3, 'git', ['diff', '--unified=0', '--no-prefix', '-M', 'aaaa..bbbb'], {
      maxBuffer: 64 * 1024 * 1024,
    });
  });

  it('feeds the raw diff output to parseAddedLines', async () => {
    routeGit('DIFF-TEXT');
    await runPatchCoverage();
    expect(parse).toHaveBeenCalledWith('DIFF-TEXT');
  });
});

describe('runPatchCoverage: coverage read gating', () => {
  it('does NOT read the coverage file when there are no added lines', async () => {
    routeGit('');
    parse.mockReturnValue([]);
    await runPatchCoverage();
    expect(readFileMock).not.toHaveBeenCalled();
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ addedByFile: [] }));
  });

  it('reads the cwd-relative coverage-final.json when there are added lines', async () => {
    routeGit('');
    parse.mockReturnValue([{ file: 'packages/engine/src/foo.ts', added: [{ line: 1, text: 'x' }] }]);
    readFileMock.mockResolvedValue('{}');
    await runPatchCoverage();
    expect(readFileMock).toHaveBeenCalledWith(COV_PATH, 'utf8');
  });

  it('fails with exit 2 and the covPath message when the coverage read throws', async () => {
    routeGit('');
    parse.mockReturnValue([{ file: 'packages/engine/src/foo.ts', added: [{ line: 1, text: 'x' }] }]);
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    const code = await runPatchCoverage();
    expect(code).toBe(2);
    expect(err.join('')).toBe(`::error::patch-coverage: cannot read ${COV_PATH}: ENOENT\n`);
    expect(decide).not.toHaveBeenCalled();
  });

  it('stringifies a non-Error thrown by the coverage read', async () => {
    routeGit('');
    parse.mockReturnValue([{ file: 'packages/engine/src/foo.ts', added: [{ line: 1, text: 'x' }] }]);
    // Deliberately a non-Error to exercise run's String(err) fallback.
    readFileMock.mockRejectedValue('disk gone');
    const code = await runPatchCoverage();
    expect(code).toBe(2);
    expect(err.join('')).toBe(`::error::patch-coverage: cannot read ${COV_PATH}: disk gone\n`);
  });
});

describe('runPatchCoverage: coverageFor wiring', () => {
  it('resolves a file to its cwd-absolute coverage record via coveredLines', async () => {
    routeGit('');
    parse.mockReturnValue([{ file: 'packages/engine/src/foo.ts', added: [{ line: 1, text: 'x' }] }]);
    const record = { s: { '0': 1 }, statementMap: { '0': { start: { line: 1 }, end: { line: 1 } } } };
    readFileMock.mockResolvedValue(JSON.stringify({ [`${cwd}/packages/engine/src/foo.ts`]: record }));
    covered.mockReturnValue({ covered: new Set([1]), uncovered: new Set() });

    await runPatchCoverage();
    const input = decide.mock.calls[0]![0];
    const result = input.coverageFor('packages/engine/src/foo.ts');
    expect(covered).toHaveBeenCalledWith(record);
    expect(result).toEqual({ covered: new Set([1]), uncovered: new Set() });
  });

  it('passes undefined to coveredLines for a file with no coverage record', async () => {
    routeGit('');
    parse.mockReturnValue([{ file: 'packages/engine/src/foo.ts', added: [{ line: 1, text: 'x' }] }]);
    readFileMock.mockResolvedValue('{}');
    covered.mockReturnValue(null);

    await runPatchCoverage();
    const input = decide.mock.calls[0]![0];
    input.coverageFor('packages/engine/src/missing.ts');
    expect(covered).toHaveBeenCalledWith(undefined);
  });
});

describe('runPatchCoverage: output surfacing', () => {
  it('writes decide()’s out lines to stdout, err lines to stderr, and returns its exit code', async () => {
    routeGit('');
    decide.mockReturnValue({ exitCode: 1, out: ['ok note'], err: ['::error boom', 'tail'] });
    const code = await runPatchCoverage();
    expect(code).toBe(1);
    expect(out.join('')).toBe('ok note\n');
    expect(err.join('')).toBe('::error boom\ntail\n');
  });

  it('returns 0 and writes only the pass line for a clean decide result', async () => {
    routeGit('');
    decide.mockReturnValue({ exitCode: 0, out: ['all good'], err: [] });
    await expect(runPatchCoverage()).resolves.toBe(0);
    expect(out.join('')).toBe('all good\n');
    expect(err.join('')).toBe('');
  });
});
