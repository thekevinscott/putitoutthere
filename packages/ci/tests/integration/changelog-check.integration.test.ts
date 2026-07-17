/**
 * Integration test for the changelog-check gate (#452, epic #442).
 *
 * Drives the real `piot-ci changelog-check` dispatch in-process — `run()`
 * from `cli.ts` → `runChangelogCheck` → `decideChangelogCheck` — with only
 * the git-subprocess boundary (the exec seam) mocked. Unlike
 * `src/changelog-check/run.test.ts` (which also mocks `decide` to isolate the
 * composition root's wiring), this exercises the real decision, so the
 * skip-trailer bypass, the missing-file `::error`, and the OK/skip messages
 * are asserted through the actual command.
 */

import type * as ChildProcess from 'node:child_process';
import { execFile } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

// Integration tests run first-party code (the exec seam) for real and mock
// only the Node built-in underneath it: `execFile` (what `execCapture` uses).
// Mocking the seam module itself would trip the testing-conventions
// `no-first-party-mock` gate.
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn() };
});

const execFileMock = vi.mocked(execFile);
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
  execFileMock.mockImplementation(((_cmd: string, args: readonly string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    const a = [...(args ?? [])];
    if (a.includes('log')) {
      cb(null, log, '');
    } else {
      cb(null, a.includes('--glob-pathspecs') ? surface : changed, '');
    }
    return undefined as unknown as ChildProcess.ChildProcess;
  }) as unknown as typeof execFile);
}

const changelogCheck = (): Promise<number> => run(['node', 'piot-ci', 'changelog-check']);

describe('piot-ci changelog-check (integration)', async () => {
  it('passes when a public-surface change updates CHANGELOG.md and MIGRATIONS.md', async () => {
    git({
      surface: 'packages/engine/src/plan.ts\n',
      changed: 'packages/engine/src/plan.ts\nCHANGELOG.md\nMIGRATIONS.md\n',
    });
    await expect(changelogCheck()).resolves.toBe(0);
    expect(out.join('')).toBe(
      ['Public-surface files changed:', '  - packages/engine/src/plan.ts', '', 'CHANGELOG.md and MIGRATIONS.md both updated. OK.', ''].join(
        '\n',
      ),
    );
  });

  it('fails, naming the missing files, when a surface change omits the changelog', async () => {
    git({ surface: 'action.yml\n', changed: 'action.yml\n' });
    await expect(changelogCheck()).resolves.toBe(1);
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

  it('is bypassed by a skip-changelog: trailer', async () => {
    git({ log: 'refactor: internal\n\nskip-changelog: pure refactor\n', surface: 'action.yml\n', changed: 'action.yml\n' });
    await expect(changelogCheck()).resolves.toBe(0);
    expect(out.join('')).toBe("Found 'skip-changelog:' trailer; bypassing check.\n");
  });

  it('skips (exit 0) when no public-surface files changed', async () => {
    git({ surface: '', changed: 'notes/internal.md\n' });
    await expect(changelogCheck()).resolves.toBe(0);
    expect(out.join('')).toBe('No public-surface files changed; skipping.\n');
  });
});
