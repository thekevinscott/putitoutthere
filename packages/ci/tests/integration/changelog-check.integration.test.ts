/**
 * Integration test for the changelog-check gate (#452, epic #442; fragments
 * #730). Drives the real `piot-ci changelog-check` dispatch in-process with
 * only the git subprocess seam mocked, so — unlike
 * `src/changelog-check/run.test.ts`, which also mocks `decide` — the real
 * fragment, skip-trailer and `::error` output is asserted.
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

// Route the git reads by their args: the commit-log `git log`, the
// public-surface `git --glob-pathspecs diff`, the added-files
// `git diff --diff-filter=A`, and any plain changed-files `git diff`.
function git({
  log = '',
  surface = '',
  added = '',
  changed = '',
}: {
  log?: string;
  surface?: string;
  added?: string;
  changed?: string;
}): void {
  execFileMock.mockImplementation(((_cmd: string, args: readonly string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    const a = [...(args ?? [])];
    if (a.includes('log')) {
      cb(null, log, '');
    } else if (a.includes('--glob-pathspecs')) {
      cb(null, surface, '');
    } else if (a.includes('--diff-filter=A')) {
      cb(null, added, '');
    } else {
      cb(null, changed, '');
    }
    return undefined as unknown as ChildProcess.ChildProcess;
  }) as unknown as typeof execFile);
}

const changelogCheck = (): Promise<number> => run(['node', 'piot-ci', 'changelog-check']);

const MISSING_HINTS = [
  "See AGENTS.md > 'Changelog and migration policy'.",
  "If the change has no consumer impact, add a commit with a 'skip-changelog:' trailer.",
];

describe('piot-ci changelog-check (integration)', async () => {
  it('passes when a public-surface change adds a changelog and a migration fragment', async () => {
    git({
      surface: 'packages/engine/src/plan.ts\n',
      added: 'changelog.d/2026-10-05-plan-verdict.md\nmigrations.d/2026-10-05-plan-verdict.md\n',
    });
    await expect(changelogCheck()).resolves.toBe(0);
    expect(out.join('')).toBe(
      [
        'Public-surface files changed:',
        '  - packages/engine/src/plan.ts',
        '',
        'Changelog and migration fragments both added. OK.',
        '',
      ].join('\n'),
    );
  });

  it('fails, naming both folders, when a surface change adds no fragment', async () => {
    git({ surface: 'action.yml\n' });
    await expect(changelogCheck()).resolves.toBe(1);
    expect(out.join('')).toBe(
      [
        'Public-surface files changed:',
        '  - action.yml',
        '',
        '::error::This PR changes public-surface files but did not add a fragment to: changelog.d/ migrations.d/',
        ...MISSING_HINTS,
        '',
      ].join('\n'),
    );
  });

  it('names only migrations.d/ when only a changelog fragment was added', async () => {
    git({ surface: 'action.yml\n', added: 'changelog.d/2026-10-05-x.md\n' });
    await expect(changelogCheck()).resolves.toBe(1);
    expect(out.join('')).toContain(
      '::error::This PR changes public-surface files but did not add a fragment to: migrations.d/\n',
    );
  });

  it('names only changelog.d/ when only a migration fragment was added', async () => {
    git({ surface: 'action.yml\n', added: 'migrations.d/2026-10-05-x.md\n' });
    await expect(changelogCheck()).resolves.toBe(1);
    expect(out.join('')).toContain(
      '::error::This PR changes public-surface files but did not add a fragment to: changelog.d/\n',
    );
  });

  it('no longer accepts edits to CHANGELOG.md / MIGRATIONS.md in place of fragments', async () => {
    git({ surface: 'action.yml\n', changed: 'action.yml\nCHANGELOG.md\nMIGRATIONS.md\n' });
    await expect(changelogCheck()).resolves.toBe(1);
    expect(out.join('')).toContain('did not add a fragment to: changelog.d/ migrations.d/');
  });

  it("does not count the folders' README.md files as fragments", async () => {
    git({ surface: 'action.yml\n', added: 'changelog.d/README.md\nmigrations.d/README.md\n' });
    await expect(changelogCheck()).resolves.toBe(1);
    expect(out.join('')).toContain('did not add a fragment to: changelog.d/ migrations.d/');
  });

  it('fails an added fragment whose filename breaks the YYYY-MM-DD-<slug>.md convention', async () => {
    git({ surface: '', added: 'changelog.d/plan-verdict.md\n' });
    await expect(changelogCheck()).resolves.toBe(1);
    expect(out.join('')).toBe(
      '::error file=changelog.d/plan-verdict.md::fragment filenames must match YYYY-MM-DD-<slug>.md (UTC merge date; lowercase letters, digits, hyphens).\n',
    );
  });

  it('is bypassed by a skip-changelog: trailer', async () => {
    git({ log: 'refactor: internal\n\nskip-changelog: pure refactor\n', surface: 'action.yml\n' });
    await expect(changelogCheck()).resolves.toBe(0);
    expect(out.join('')).toBe("Found 'skip-changelog:' trailer; bypassing check.\n");
  });

  it('skips (exit 0) when no public-surface files changed', async () => {
    git({ surface: '', added: 'notes/internal.md\n' });
    await expect(changelogCheck()).resolves.toBe(0);
    expect(out.join('')).toBe('No public-surface files changed; skipping.\n');
  });
});
