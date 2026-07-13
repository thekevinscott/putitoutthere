/**
 * Composition root for the changelog-check gate (#452): reads BASE_SHA /
 * HEAD_SHA, runs the `git log` / `git diff` invocations, feeds them to
 * `decideChangelogCheck`, writes the lines, returns the exit code. Both
 * collaborators are mocked (the `node:child_process` boundary and `decide`)
 * so this isolates the wiring: that run parses git output into the right
 * decide() input, and surfaces decide()'s lines + exit code unchanged. The
 * real decisions are covered in `decide.test.ts`; the end-to-end gate is
 * exercised on every PR by the workflow itself.
 */

import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decideChangelogCheck } from './decide.js';
import { runChangelogCheck } from './run.js';

vi.mock('node:child_process');
vi.mock('./decide.js');

const exec = vi.mocked(execFileSync);
const decide = vi.mocked(decideChangelogCheck);
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
function gitStub(map: { log?: string; surface?: string; changed?: string }): void {
  exec.mockImplementation((_cmd, args) => {
    const a = (args as readonly string[]).join(' ');
    if (a.includes('log')) {return map.log ?? '';}
    if (a.includes('--glob-pathspecs')) {return map.surface ?? '';}
    return map.changed ?? '';
  });
}

describe('runChangelogCheck', () => {
  it('parses git output into decide()’s input (splitting + dropping blanks)', () => {
    gitStub({
      log: 'feat: x\n',
      surface: 'action.yml\npackages/engine/src/plan.ts\n',
      changed: 'action.yml\nCHANGELOG.md\n',
    });
    runChangelogCheck();
    expect(decide).toHaveBeenCalledWith({
      commitLog: 'feat: x\n',
      surfaceFiles: ['action.yml', 'packages/engine/src/plan.ts'],
      changedFiles: ['action.yml', 'CHANGELOG.md'],
    });
  });

  it('writes decide()’s lines and returns its exit code', () => {
    gitStub({ log: '', surface: 'action.yml\n', changed: '' });
    decide.mockReturnValue({ exitCode: 1, lines: ['::error::boom', 'second line'] });
    const code = runChangelogCheck();
    expect(code).toBe(1);
    expect(out.join('')).toBe('::error::boom\nsecond line\n');
  });

  it('fails clearly and never shells out when BASE_SHA is absent', () => {
    delete process.env.BASE_SHA;
    gitStub({});
    const code = runChangelogCheck();
    expect(code).toBe(1);
    expect(out.join('')).toContain('BASE_SHA and HEAD_SHA must be set');
    expect(exec).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it('fails clearly when HEAD_SHA is empty', () => {
    process.env.HEAD_SHA = '';
    const code = runChangelogCheck();
    expect(code).toBe(1);
    expect(exec).not.toHaveBeenCalled();
  });
});
