/**
 * Decision matrix for the changelog-check gate (#452), extracted from the
 * inline bash in `.github/workflows/changelog-check.yml`. Pins the exact
 * pass/fail decisions and every emitted line the bash produced, so the
 * TypeScript reimplementation is provably equivalent. Pure — no I/O — so
 * every branch is driven by plain inputs. Assertions are exact (`toEqual`
 * on the full line list) so a dropped or altered message is caught.
 */

import { describe, expect, it } from 'vitest';

import { decideChangelogCheck } from './decide.js';

const surfaceOnly = {
  commitLog: 'feat: something\n',
  surfaceFiles: ['packages/engine/src/plan.ts'],
};

describe('decideChangelogCheck: skip-changelog trailer', () => {
  it('bypasses (exact line) on a trailer, even with surface changed and no changelog', () => {
    const r = decideChangelogCheck({ commitLog: 'feat: x\n\nskip-changelog: internal\n', surfaceFiles: ['action.yml'], changedFiles: [] });
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual(["Found 'skip-changelog:' trailer; bypassing check."]);
  });

  it('is case-insensitive', () => {
    expect(decideChangelogCheck({ ...surfaceOnly, commitLog: 'SKIP-CHANGELOG: x\n', changedFiles: [] }).exitCode).toBe(0);
  });

  it('matches a value with no space after the colon', () => {
    expect(decideChangelogCheck({ ...surfaceOnly, commitLog: 'skip-changelog:x\n', changedFiles: [] }).exitCode).toBe(0);
  });

  it('does NOT bypass when the trailer is not at the start of a line', () => {
    expect(decideChangelogCheck({ ...surfaceOnly, commitLog: 'xskip-changelog: y\n', changedFiles: [] }).exitCode).toBe(1);
  });

  it('does NOT bypass when the trailer has no value', () => {
    expect(decideChangelogCheck({ ...surfaceOnly, commitLog: 'skip-changelog:\n', changedFiles: [] }).exitCode).toBe(1);
  });

  it('does NOT bypass an unrelated commit log', () => {
    expect(decideChangelogCheck({ ...surfaceOnly, commitLog: 'chore: skip the changelog someday\n', changedFiles: [] }).exitCode).toBe(1);
  });
});

describe('decideChangelogCheck: surface detection', () => {
  it('passes with the exact line when no public-surface files changed', () => {
    const r = decideChangelogCheck({ commitLog: 'docs: x\n', surfaceFiles: [], changedFiles: ['README.md'] });
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual(['No public-surface files changed; skipping.']);
  });
});

describe('decideChangelogCheck: changelog + migration requirement', () => {
  it('fails with the exact lines when neither file is updated', () => {
    const r = decideChangelogCheck({
      commitLog: 'feat: x\n',
      surfaceFiles: ['action.yml', 'packages/engine/src/plan.ts'],
      changedFiles: ['action.yml', 'packages/engine/src/plan.ts'],
    });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      'Public-surface files changed:',
      '  - action.yml',
      '  - packages/engine/src/plan.ts',
      '',
      '::error::This PR changes public-surface files but did not update: CHANGELOG.md MIGRATIONS.md',
      "See AGENTS.md > 'Changelog and migration policy'.",
      "If the change has no consumer impact, add a commit with a 'skip-changelog:' trailer.",
    ]);
  });

  it('names only MIGRATIONS.md when CHANGELOG.md is present', () => {
    const r = decideChangelogCheck({ ...surfaceOnly, changedFiles: ['packages/engine/src/plan.ts', 'CHANGELOG.md'] });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toContain('::error::This PR changes public-surface files but did not update: MIGRATIONS.md');
  });

  it('names only CHANGELOG.md when MIGRATIONS.md is present', () => {
    const r = decideChangelogCheck({ ...surfaceOnly, changedFiles: ['packages/engine/src/plan.ts', 'MIGRATIONS.md'] });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toContain('::error::This PR changes public-surface files but did not update: CHANGELOG.md');
  });

  it('passes with the exact final line when both files are updated', () => {
    const r = decideChangelogCheck({
      ...surfaceOnly,
      changedFiles: ['packages/engine/src/plan.ts', 'CHANGELOG.md', 'MIGRATIONS.md'],
    });
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual([
      'Public-surface files changed:',
      '  - packages/engine/src/plan.ts',
      '',
      'CHANGELOG.md and MIGRATIONS.md both updated. OK.',
    ]);
  });

  it('matches CHANGELOG.md / MIGRATIONS.md only as whole lines, not suffixes', () => {
    // A `docs/CHANGELOG.md` / `sub/MIGRATIONS.md` change must not satisfy the check.
    const r = decideChangelogCheck({
      ...surfaceOnly,
      changedFiles: ['packages/engine/src/plan.ts', 'docs/CHANGELOG.md', 'sub/MIGRATIONS.md'],
    });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toContain('::error::This PR changes public-surface files but did not update: CHANGELOG.md MIGRATIONS.md');
  });
});
