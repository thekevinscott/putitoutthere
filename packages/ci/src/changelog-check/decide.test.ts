/**
 * Decision matrix for the changelog-check gate (#452), extracted from the
 * inline bash in `.github/workflows/changelog-check.yml`. Pins the exact
 * pass/fail decisions and `::error::` text the bash produced, so the
 * TypeScript reimplementation is provably equivalent. Pure — no I/O — so
 * every branch is driven by plain inputs.
 */

import { describe, expect, it } from 'vitest';

import { decideChangelogCheck } from './decide.js';

const base = {
  commitLog: 'feat: something\n',
  surfaceFiles: ['packages/engine/src/plan.ts'],
  changedFiles: [] as string[],
};

describe('decideChangelogCheck', () => {
  it('bypasses on a skip-changelog: trailer (case-insensitive)', () => {
    const r = decideChangelogCheck({ ...base, commitLog: 'feat: x\n\nSKIP-changelog: internal refactor\n' });
    expect(r.exitCode).toBe(0);
    expect(r.lines.join('\n')).toContain("Found 'skip-changelog:' trailer");
  });

  it('bypass takes precedence even when surface changed and no changelog', () => {
    const r = decideChangelogCheck({ commitLog: 'skip-changelog: x\n', surfaceFiles: ['action.yml'], changedFiles: [] });
    expect(r.exitCode).toBe(0);
  });

  it('passes when no public-surface files changed', () => {
    const r = decideChangelogCheck({ ...base, surfaceFiles: [] });
    expect(r.exitCode).toBe(0);
    expect(r.lines.join('\n')).toContain('No public-surface files changed');
  });

  it('lists the changed surface files with the "  - " prefix', () => {
    const r = decideChangelogCheck({ ...base, changedFiles: [] });
    expect(r.lines.join('\n')).toContain('  - packages/engine/src/plan.ts');
  });

  it('fails naming both files when surface changed and neither updated', () => {
    const r = decideChangelogCheck({ ...base, changedFiles: ['packages/engine/src/plan.ts'] });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toContain(
      '::error::This PR changes public-surface files but did not update: CHANGELOG.md MIGRATIONS.md',
    );
  });

  it('fails naming only MIGRATIONS.md when CHANGELOG.md is present', () => {
    const r = decideChangelogCheck({
      ...base,
      changedFiles: ['packages/engine/src/plan.ts', 'CHANGELOG.md'],
    });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toContain('did not update: MIGRATIONS.md');
    expect(r.lines.join('\n')).not.toContain('CHANGELOG.md MIGRATIONS.md');
  });

  it('passes when surface changed and both files updated', () => {
    const r = decideChangelogCheck({
      ...base,
      changedFiles: ['packages/engine/src/plan.ts', 'CHANGELOG.md', 'MIGRATIONS.md'],
    });
    expect(r.exitCode).toBe(0);
    expect(r.lines.join('\n')).toContain('both updated. OK');
  });

  it('matches CHANGELOG.md only as a whole line, not a suffix', () => {
    // grep -xF semantics: `docs/CHANGELOG.md` must not satisfy the check.
    const r = decideChangelogCheck({
      ...base,
      changedFiles: ['packages/engine/src/plan.ts', 'docs/CHANGELOG.md', 'sub/MIGRATIONS.md'],
    });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toContain('CHANGELOG.md MIGRATIONS.md');
  });
});
