/**
 * Composition-root wiring for the actionlint id-token gate (#452): fs and
 * `decide` are both mocked, so this pins the exact files read and that decide's
 * lines + exit code surface unchanged. Decisions live in `decide.test.ts`.
 */

import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decideActionlintIdToken } from './decide.js';
import { runActionlintIdToken } from './run.js';

vi.mock('node:fs/promises');
vi.mock('./decide.js');

const read = vi.mocked(readFile);
const decide = vi.mocked(decideActionlintIdToken);
const out: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  read.mockImplementation(((path: string) => Promise.resolve(`content of ${path}`)) as unknown as typeof readFile);
  decide.mockReturnValue({ exitCode: 0, lines: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runActionlintIdToken', () => {
  it('reads exactly the three PR-time-path files, each as utf8', async () => {
    await runActionlintIdToken();
    expect(read).toHaveBeenNthCalledWith(1, '.github/workflows/build.yml', 'utf8');
    expect(read).toHaveBeenNthCalledWith(2, '.github/workflows/_matrix.yml', 'utf8');
    expect(read).toHaveBeenNthCalledWith(3, '.github/workflows/check.yml', 'utf8');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('assembles the files (path + content) into decide()’s input', async () => {
    await runActionlintIdToken();
    expect(decide).toHaveBeenCalledWith({
      files: [
        { path: '.github/workflows/build.yml', content: 'content of .github/workflows/build.yml' },
        { path: '.github/workflows/_matrix.yml', content: 'content of .github/workflows/_matrix.yml' },
        { path: '.github/workflows/check.yml', content: 'content of .github/workflows/check.yml' },
      ],
    });
  });

  it('writes decide()’s lines verbatim (one per line) and returns its exit code', async () => {
    decide.mockReturnValue({ exitCode: 1, lines: ['42:  id-token: write', '::error file=x::boom'] });
    const code = await runActionlintIdToken();
    expect(code).toBe(1);
    expect(out.join('')).toBe('42:  id-token: write\n::error file=x::boom\n');
  });

  it('returns 0 and writes nothing when decide passes with no lines', async () => {
    decide.mockReturnValue({ exitCode: 0, lines: [] });
    await expect(runActionlintIdToken()).resolves.toBe(0);
    expect(out.join('')).toBe('');
  });
});
