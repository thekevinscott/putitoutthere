/**
 * Composition root for the changelog-check gate (#452): reads BASE_SHA /
 * HEAD_SHA from the env, runs the three `git log` / `git diff` invocations,
 * feeds them to `decideChangelogCheck`, writes the lines, and returns the
 * exit code. The subprocess + env boundary is mocked; the real decision is
 * `decide.ts`'s (unit-tested there). This pins that the wiring reads the
 * right git output and surfaces decide()'s verdict unchanged.
 */

import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runChangelogCheck } from './run.js';

vi.mock('node:child_process');

const exec = vi.mocked(execFileSync);
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
    if (a.includes('log')) return map.log ?? '';
    if (a.includes('--glob-pathspecs')) return map.surface ?? '';
    return map.changed ?? '';
  });
}

describe('runChangelogCheck', () => {
  it('surfaces decide()=fail (surface changed, no changelog) as exit 1 with the error', () => {
    gitStub({ log: 'feat: x\n', surface: 'packages/engine/src/plan.ts\n', changed: 'packages/engine/src/plan.ts\n' });
    const code = runChangelogCheck();
    expect(code).toBe(1);
    expect(out.join('')).toContain('::error::This PR changes public-surface files but did not update');
  });

  it('surfaces decide()=pass (both files updated) as exit 0', () => {
    gitStub({
      log: 'feat: x\n',
      surface: 'packages/engine/src/plan.ts\n',
      changed: 'packages/engine/src/plan.ts\nCHANGELOG.md\nMIGRATIONS.md\n',
    });
    expect(runChangelogCheck()).toBe(0);
    expect(out.join('')).toContain('both updated. OK');
  });

  it('bypasses when git log carries a skip-changelog trailer', () => {
    gitStub({ log: 'chore: x\n\nskip-changelog: internal\n', surface: 'action.yml\n', changed: '' });
    expect(runChangelogCheck()).toBe(0);
    expect(out.join('')).toContain('bypassing');
  });

  it('passes when git reports no surface files changed', () => {
    gitStub({ log: 'docs: x\n', surface: '', changed: 'README.md\n' });
    expect(runChangelogCheck()).toBe(0);
    expect(out.join('')).toContain('No public-surface files changed');
  });

  it('fails clearly when BASE_SHA / HEAD_SHA are absent', () => {
    delete process.env.BASE_SHA;
    gitStub({});
    expect(runChangelogCheck()).toBe(1);
  });
});
