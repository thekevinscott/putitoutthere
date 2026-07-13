/**
 * Integration test for the changelog-check gate (#452, epic #442).
 *
 * Drives the real `piot-ci changelog-check` dispatch in-process — `run()`
 * from `cli.ts` → `runChangelogCheck` → `decideChangelogCheck` — with only
 * the git-subprocess boundary (`node:child_process`) mocked. Unlike
 * `src/changelog-check/run.test.ts` (which also mocks `decide` to isolate the
 * composition root's wiring), this exercises the real decision, so the
 * skip-trailer bypass, the missing-file `::error`, and the OK/skip messages
 * are asserted through the actual command.
 */

import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

vi.mock('node:child_process');

const exec = vi.mocked(execFileSync);
let out: string[];

beforeEach(() => {
  out = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
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

// Route the three git reads the gate performs: the commit-log `git log`, the
// public-surface `git --glob-pathspecs diff`, and the plain changed-files
// `git diff`.
function git({ log = '', surface = '', changed = '' }: { log?: string; surface?: string; changed?: string }): void {
  exec.mockImplementation((_cmd, args) => {
    const a = args as readonly string[];
    if (a.includes('log')) {
      return log;
    }
    return a.includes('--glob-pathspecs') ? surface : changed;
  });
}

const changelogCheck = (): number => run(['node', 'piot-ci', 'changelog-check']);

describe('piot-ci changelog-check (integration)', () => {
  it('passes when a public-surface change updates CHANGELOG.md and MIGRATIONS.md', () => {
    git({
      surface: 'packages/engine/src/plan.ts\n',
      changed: 'packages/engine/src/plan.ts\nCHANGELOG.md\nMIGRATIONS.md\n',
    });
    expect(changelogCheck()).toBe(0);
    expect(out.join('')).toBe(
      ['Public-surface files changed:', '  - packages/engine/src/plan.ts', '', 'CHANGELOG.md and MIGRATIONS.md both updated. OK.', ''].join(
        '\n',
      ),
    );
  });

  it('fails, naming the missing files, when a surface change omits the changelog', () => {
    git({ surface: 'action.yml\n', changed: 'action.yml\n' });
    expect(changelogCheck()).toBe(1);
    expect(out.join('')).toBe(
      [
        'Public-surface files changed:',
        '  - action.yml',
        '',
        '::error::This PR changes public-surface files but did not update: CHANGELOG.md MIGRATIONS.md',
        "See AGENTS.md > 'Changelog and migration policy'.",
        "If the change has no consumer impact, add a commit with a 'skip-changelog:' trailer.",
        '',
      ].join('\n'),
    );
  });

  it('is bypassed by a skip-changelog: trailer', () => {
    git({ log: 'refactor: internal\n\nskip-changelog: pure refactor\n', surface: 'action.yml\n', changed: 'action.yml\n' });
    expect(changelogCheck()).toBe(0);
    expect(out.join('')).toBe("Found 'skip-changelog:' trailer; bypassing check.\n");
  });

  it('skips (exit 0) when no public-surface files changed', () => {
    git({ surface: '', changed: 'notes/internal.md\n' });
    expect(changelogCheck()).toBe(0);
    expect(out.join('')).toBe('No public-surface files changed; skipping.\n');
  });
});
