/**
 * Decision matrix for the changelog-check gate (#452; fragments #730). Exact
 * `toEqual` on the full line list, so a dropped or altered message is caught.
 */

import { describe, expect, it } from 'vitest';

import { decideChangelogCheck } from './decide.js';

const surfaceOnly = {
  commitLog: 'feat: something\n',
  surfaceFiles: ['packages/engine/src/plan.ts'],
};

const CHANGELOG_FRAGMENT = 'changelog.d/2026-10-05-plan-verdict.md';
const MIGRATION_FRAGMENT = 'migrations.d/2026-10-05-plan-verdict.md';
const MALFORMED_LINE = (path: string): string =>
  `::error file=${path}::fragment filenames must match YYYY-MM-DD-<slug>.md (UTC merge date; lowercase letters, digits, hyphens).`;

describe('decideChangelogCheck: skip-changelog trailer', () => {
  it('bypasses (exact line) on a trailer, even with surface changed and no fragment', () => {
    const r = decideChangelogCheck({ commitLog: 'feat: x\n\nskip-changelog: internal\n', surfaceFiles: ['action.yml'], addedFiles: [] });
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual(["Found 'skip-changelog:' trailer; bypassing check."]);
  });

  it('bypasses the filename check too', () => {
    const r = decideChangelogCheck({ commitLog: 'skip-changelog: x\n', surfaceFiles: [], addedFiles: ['changelog.d/bad.md'] });
    expect(r.exitCode).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(decideChangelogCheck({ ...surfaceOnly, commitLog: 'SKIP-CHANGELOG: x\n', addedFiles: [] }).exitCode).toBe(0);
  });

  it('matches a value with no space after the colon', () => {
    expect(decideChangelogCheck({ ...surfaceOnly, commitLog: 'skip-changelog:x\n', addedFiles: [] }).exitCode).toBe(0);
  });

  it('does NOT bypass when the trailer is not at the start of a line', () => {
    expect(decideChangelogCheck({ ...surfaceOnly, commitLog: 'xskip-changelog: y\n', addedFiles: [] }).exitCode).toBe(1);
  });

  it('does NOT bypass when the trailer has no value', () => {
    expect(decideChangelogCheck({ ...surfaceOnly, commitLog: 'skip-changelog:\n', addedFiles: [] }).exitCode).toBe(1);
  });

  it('does NOT bypass an unrelated commit log', () => {
    expect(decideChangelogCheck({ ...surfaceOnly, commitLog: 'chore: skip the changelog someday\n', addedFiles: [] }).exitCode).toBe(1);
  });
});

describe('decideChangelogCheck: surface detection', () => {
  it('passes with the exact line when no public-surface files changed', () => {
    const r = decideChangelogCheck({ commitLog: 'docs: x\n', surfaceFiles: [], addedFiles: ['README.md'] });
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual(['No public-surface files changed; skipping.']);
  });
});

describe('decideChangelogCheck: fragment requirement', () => {
  it('fails with the exact lines when neither fragment is added', () => {
    const r = decideChangelogCheck({
      commitLog: 'feat: x\n',
      surfaceFiles: ['action.yml', 'packages/engine/src/plan.ts'],
      addedFiles: ['packages/engine/src/new.ts'],
    });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      'Public-surface files changed:',
      '  - action.yml',
      '  - packages/engine/src/plan.ts',
      '',
      '::error::This PR changes public-surface files but did not add a fragment to: changelog.d/ migrations.d/',
      "See AGENTS.md > 'Changelog and migration policy'.",
      "If the change has no consumer impact, add a commit with a 'skip-changelog:' trailer.",
    ]);
  });

  it('names only migrations.d/ when the changelog fragment is present', () => {
    const r = decideChangelogCheck({ ...surfaceOnly, addedFiles: [CHANGELOG_FRAGMENT] });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toContain('::error::This PR changes public-surface files but did not add a fragment to: migrations.d/');
  });

  it('names only changelog.d/ when the migration fragment is present', () => {
    const r = decideChangelogCheck({ ...surfaceOnly, addedFiles: [MIGRATION_FRAGMENT] });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toContain('::error::This PR changes public-surface files but did not add a fragment to: changelog.d/');
  });

  it('passes with the exact final line when both fragments are added', () => {
    const r = decideChangelogCheck({ ...surfaceOnly, addedFiles: [CHANGELOG_FRAGMENT, MIGRATION_FRAGMENT] });
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual([
      'Public-surface files changed:',
      '  - packages/engine/src/plan.ts',
      '',
      'Changelog and migration fragments both added. OK.',
    ]);
  });

  it("does not count the folders' README.md files", () => {
    const r = decideChangelogCheck({ ...surfaceOnly, addedFiles: ['changelog.d/README.md', 'migrations.d/README.md'] });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toContain('::error::This PR changes public-surface files but did not add a fragment to: changelog.d/ migrations.d/');
  });

  it('does not count a fragment-named file outside the folders', () => {
    const r = decideChangelogCheck({ ...surfaceOnly, addedFiles: ['docs/changelog.d/2026-10-05-x.md', 'notes/2026-10-05-x.md'] });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toContain('::error::This PR changes public-surface files but did not add a fragment to: changelog.d/ migrations.d/');
  });
});

describe('decideChangelogCheck: fragment filenames', () => {
  it('fails each misnamed fragment with an exact file annotation, even with no surface change', () => {
    const r = decideChangelogCheck({
      commitLog: 'docs: x\n',
      surfaceFiles: [],
      addedFiles: ['changelog.d/plan.md', 'migrations.d/2026-10-05-Plan.md', 'changelog.d/README.md', 'notes/plan.md'],
    });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([MALFORMED_LINE('changelog.d/plan.md'), MALFORMED_LINE('migrations.d/2026-10-05-Plan.md')]);
  });

  it('fails a misnamed extra fragment even when both required fragments are present', () => {
    const r = decideChangelogCheck({
      ...surfaceOnly,
      addedFiles: [CHANGELOG_FRAGMENT, MIGRATION_FRAGMENT, 'changelog.d/extra.md'],
    });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      MALFORMED_LINE('changelog.d/extra.md'),
      'Public-surface files changed:',
      '  - packages/engine/src/plan.ts',
      '',
    ]);
  });

  it('reports the misnamed file ahead of the missing-fragment error', () => {
    const r = decideChangelogCheck({ ...surfaceOnly, addedFiles: ['changelog.d/plan.md'] });
    expect(r.exitCode).toBe(1);
    expect(r.lines[0]).toBe(MALFORMED_LINE('changelog.d/plan.md'));
    expect(r.lines).toContain('::error::This PR changes public-surface files but did not add a fragment to: changelog.d/ migrations.d/');
  });
});
