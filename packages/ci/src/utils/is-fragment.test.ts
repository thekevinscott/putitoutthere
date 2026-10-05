import { describe, expect, it } from 'vitest';

import { isFragment } from './is-fragment.js';

describe('isFragment', () => {
  it('accepts a dated, slugged markdown file directly in the folder', () => {
    expect(isFragment('changelog.d/2026-10-05-plan-verdict.md', 'changelog.d')).toBe(true);
  });

  it('accepts a single-character slug and digits in the slug', () => {
    expect(isFragment('migrations.d/2026-10-05-x.md', 'migrations.d')).toBe(true);
    expect(isFragment('migrations.d/2026-10-05-pnpm-11.md', 'migrations.d')).toBe(true);
  });

  it('rejects a file in a different folder', () => {
    expect(isFragment('migrations.d/2026-10-05-x.md', 'changelog.d')).toBe(false);
  });

  it('rejects a same-length folder whose remainder is a valid fragment name', () => {
    expect(isFragment('changelog-d/2026-10-05-x.md', 'changelog.d')).toBe(false);
  });

  it('rejects a folder name that only shares a prefix', () => {
    expect(isFragment('changelog.d.old/2026-10-05-x.md', 'changelog.d')).toBe(false);
  });

  it('rejects a path that merely contains the folder', () => {
    expect(isFragment('docs/changelog.d/2026-10-05-x.md', 'changelog.d')).toBe(false);
  });

  it("rejects the folder's README.md", () => {
    expect(isFragment('changelog.d/README.md', 'changelog.d')).toBe(false);
  });

  it('rejects a nested file', () => {
    expect(isFragment('changelog.d/sub/2026-10-05-x.md', 'changelog.d')).toBe(false);
  });

  it('rejects an undated name', () => {
    expect(isFragment('changelog.d/plan-verdict.md', 'changelog.d')).toBe(false);
  });

  it.each([
    ['a short year', 'changelog.d/226-10-05-x.md'],
    ['a short month', 'changelog.d/2026-1-05-x.md'],
    ['a short day', 'changelog.d/2026-10-5-x.md'],
    ['a non-digit date', 'changelog.d/2026-1o-05-x.md'],
    ['a missing slug', 'changelog.d/2026-10-05-.md'],
    ['a missing slug separator', 'changelog.d/2026-10-05x.md'],
    ['an uppercase slug', 'changelog.d/2026-10-05-Plan.md'],
    ['an underscore in the slug', 'changelog.d/2026-10-05-plan_verdict.md'],
    ['a non-markdown extension', 'changelog.d/2026-10-05-x.txt'],
    ['a trailing suffix', 'changelog.d/2026-10-05-x.md.bak'],
    ['a leading prefix', 'changelog.d/x2026-10-05-x.md'],
    ['a dot in place of the extension dot', 'changelog.d/2026-10-05-xamd'],
  ])('rejects %s', (_label, path) => {
    expect(isFragment(path, 'changelog.d')).toBe(false);
  });
});
