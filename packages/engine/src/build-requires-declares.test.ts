import { describe, expect, it } from 'vitest';

import { buildRequiresDeclares } from './build-requires-declares.js';

describe('buildRequiresDeclares (#696)', () => {
  it('matches a bare name', () => {
    expect(buildRequiresDeclares(['hatchling', 'hatch-vcs'], 'hatch-vcs')).toBe(true);
  });

  it('does not match a name that is merely a prefix of a declared one', () => {
    // `hatchling` starts with `hatch`, and `hatch-vcs` is not declared.
    // A `startsWith` implementation would wrongly accept this.
    expect(buildRequiresDeclares(['hatchling'], 'hatch-vcs')).toBe(false);
  });

  it('does not match a name that merely contains the wanted one', () => {
    expect(buildRequiresDeclares(['hatch-vcs-extras'], 'hatch-vcs')).toBe(false);
  });

  it('strips a version specifier before comparing', () => {
    expect(buildRequiresDeclares(['setuptools>=61', 'setuptools-scm>=8'], 'setuptools-scm')).toBe(
      true,
    );
  });

  it.each([
    ['setuptools_scm', 'underscore'],
    ['Setuptools-SCM', 'mixed case'],
    ['setuptools.scm', 'dot'],
    ['setuptools__scm', 'repeated separator'],
  ])('normalises %s (%s) to the canonical name', (declared) => {
    expect(buildRequiresDeclares([declared], 'setuptools-scm')).toBe(true);
  });

  it('normalises every separator in the name, not just the first', () => {
    expect(
      buildRequiresDeclares(['setuptools_scm_git_archive'], 'setuptools-scm-git-archive'),
    ).toBe(true);
  });

  it.each([
    ['setuptools-scm[toml]>=8', 'extras'],
    ["setuptools-scm ; python_version < '3.9'", 'an environment marker'],
    ['setuptools-scm@https://example.invalid/sdist.tar.gz', 'a direct reference'],
    ['setuptools-scm (>=8)', 'parenthesised specifier'],
    ['setuptools-scm!=7.0', 'an exclusion specifier'],
    ['setuptools-scm~=8.0', 'a compatible-release specifier'],
    ['setuptools-scm<9', 'an upper bound'],
    ['setuptools-scm>7', 'a lower bound'],
    ['setuptools-scm==8.0.4', 'an exact pin'],
    ['setuptools-scm\t>=8', 'a tab'],
    ['  setuptools-scm  ', 'surrounding whitespace'],
  ])('matches %s (%s)', (declared) => {
    expect(buildRequiresDeclares([declared], 'setuptools-scm')).toBe(true);
  });

  it('returns false for a missing or non-array requires', () => {
    // A pyproject with no [build-system] table at all reaches here as
    // `undefined`; the engine deliberately tolerates that table being
    // absent, so this must not throw.
    expect(buildRequiresDeclares(undefined, 'hatch-vcs')).toBe(false);
    expect(buildRequiresDeclares('hatch-vcs', 'hatch-vcs')).toBe(false);
    expect(buildRequiresDeclares({}, 'hatch-vcs')).toBe(false);
    expect(buildRequiresDeclares([], 'hatch-vcs')).toBe(false);
  });

  it('skips non-string entries without throwing', () => {
    expect(buildRequiresDeclares([null, 42, {}, 'hatch-vcs'], 'hatch-vcs')).toBe(true);
    expect(buildRequiresDeclares([null, 42, {}], 'hatch-vcs')).toBe(false);
  });
});
