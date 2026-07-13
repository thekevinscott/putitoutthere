/**
 * Composition root for the actionlint id-token gate (#452): reads the three
 * PR-time-path workflow files, feeds their contents to
 * `decideActionlintIdToken`, writes the lines, returns the exit code. Both
 * collaborators are mocked (the `node:fs` boundary and `decide`) so this
 * isolates the wiring. It asserts the *exact* files read (path + encoding),
 * that their contents are assembled into decide()'s input, and that decide()'s
 * lines + exit code are surfaced unchanged. The decisions themselves are
 * covered in `decide.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decideActionlintIdToken } from './decide.js';
import { runActionlintIdToken } from './run.js';

vi.mock('node:fs');
vi.mock('./decide.js');

const read = vi.mocked(readFileSync);
const decide = vi.mocked(decideActionlintIdToken);
const out: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  read.mockImplementation((path) => `content of ${String(path)}`);
  decide.mockReturnValue({ exitCode: 0, lines: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runActionlintIdToken', () => {
  it('reads exactly the three PR-time-path files, each as utf8', () => {
    runActionlintIdToken();
    expect(read).toHaveBeenNthCalledWith(1, '.github/workflows/build.yml', 'utf8');
    expect(read).toHaveBeenNthCalledWith(2, '.github/workflows/_matrix.yml', 'utf8');
    expect(read).toHaveBeenNthCalledWith(3, '.github/workflows/check.yml', 'utf8');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('assembles the files (path + content) into decide()’s input', () => {
    runActionlintIdToken();
    expect(decide).toHaveBeenCalledWith({
      files: [
        { path: '.github/workflows/build.yml', content: 'content of .github/workflows/build.yml' },
        { path: '.github/workflows/_matrix.yml', content: 'content of .github/workflows/_matrix.yml' },
        { path: '.github/workflows/check.yml', content: 'content of .github/workflows/check.yml' },
      ],
    });
  });

  it('writes decide()’s lines verbatim (one per line) and returns its exit code', () => {
    decide.mockReturnValue({ exitCode: 1, lines: ['42:  id-token: write', '::error file=x::boom'] });
    const code = runActionlintIdToken();
    expect(code).toBe(1);
    expect(out.join('')).toBe('42:  id-token: write\n::error file=x::boom\n');
  });

  it('returns 0 and writes nothing when decide passes with no lines', () => {
    decide.mockReturnValue({ exitCode: 0, lines: [] });
    expect(runActionlintIdToken()).toBe(0);
    expect(out.join('')).toBe('');
  });
});
