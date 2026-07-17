/**
 * Composition root for the tdd-lint gate (#452): reads BASE_SHA / HEAD_SHA,
 * runs the `git log` / `git diff` invocations, feeds them to `decideTddLint`,
 * writes the lines, returns the exit code. Both collaborators are mocked
 * (the `node:child_process` boundary and `decide`) so this isolates the
 * wiring. It asserts the *exact* git commands run (including the
 * `packages/engine/src/` pathspec), that git output is parsed into the right
 * decide() input, and that decide()'s lines + exit code are surfaced
 * unchanged. The decisions themselves are covered in `decide.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture } from '../utils/exec-capture.js';
import { decideTddLint } from './decide.js';
import { runTddLint } from './run.js';

vi.mock('../utils/exec-capture.js');
vi.mock('./decide.js');

const exec = vi.mocked(execCapture);
const decide = vi.mocked(decideTddLint);
const out: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  process.env.BASE_SHA = 'aaaa';
  process.env.HEAD_SHA = 'bbbb';
  decide.mockReturnValue({ exitCode: 0, lines: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BASE_SHA;
  delete process.env.HEAD_SHA;
});

// Route each git call by the subcommand in its args.
function gitStub(map: { log?: string; changed?: string }): void {
  exec.mockImplementation((_cmd, args) => {
    const a = args.join(' ');
    if (a.includes('log')) {
      return Promise.resolve({ stdout: map.log ?? '', stderr: '' });
    }
    return Promise.resolve({ stdout: map.changed ?? '', stderr: '' });
  });
}

describe('runTddLint', () => {
  it('runs the exact git log / diff commands, including the engine/src pathspec', async () => {
    gitStub({ log: '', changed: '' });
    await runTddLint();

    expect(exec).toHaveBeenNthCalledWith(1, 'git', ['log', '--format=%B', 'aaaa..bbbb']);
    expect(exec).toHaveBeenNthCalledWith(
      2,
      'git',
      ['diff', '--name-only', 'aaaa', 'bbbb', '--', 'packages/engine/src/'],
    );
  });

  it('parses git output into decide()’s input (splitting on newlines, dropping blanks)', async () => {
    gitStub({
      log: 'feat: x\n',
      changed: 'packages/engine/src/plan.ts\npackages/engine/src/plan.test.ts\n',
    });
    await runTddLint();
    expect(decide).toHaveBeenCalledWith({
      commitLog: 'feat: x\n',
      changedFiles: ['packages/engine/src/plan.ts', 'packages/engine/src/plan.test.ts'],
    });
  });

  it('writes decide()’s lines verbatim (one per line) and returns its exit code', async () => {
    gitStub({ log: '', changed: 'packages/engine/src/plan.ts\n' });
    decide.mockReturnValue({ exitCode: 1, lines: ['::error::boom', 'second line'] });
    const code = await runTddLint();
    expect(code).toBe(1);
    expect(out.join('')).toBe('::error::boom\nsecond line\n');
  });

  it('returns 0 and writes nothing extra when decide passes with no lines', async () => {
    gitStub({ log: '', changed: '' });
    decide.mockReturnValue({ exitCode: 0, lines: [] });
    await expect(runTddLint()).resolves.toBe(0);
    expect(out.join('')).toBe('');
  });

  it('fails clearly and never shells out when BASE_SHA is absent', async () => {
    delete process.env.BASE_SHA;
    const code = await runTddLint();
    expect(code).toBe(1);
    expect(out.join('')).toBe('::error::tdd-lint: BASE_SHA and HEAD_SHA must be set.\n');
    expect(exec).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it('fails clearly when BASE_SHA is the empty string', async () => {
    process.env.BASE_SHA = '';
    await expect(runTddLint()).resolves.toBe(1);
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails clearly when HEAD_SHA is absent', async () => {
    delete process.env.HEAD_SHA;
    await expect(runTddLint()).resolves.toBe(1);
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails clearly when HEAD_SHA is the empty string', async () => {
    process.env.HEAD_SHA = '';
    await expect(runTddLint()).resolves.toBe(1);
    expect(exec).not.toHaveBeenCalled();
  });
});
