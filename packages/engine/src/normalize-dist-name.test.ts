import { describe, expect, it } from 'vitest';

import { normalizeDistName } from './normalize-dist-name.js';

describe('normalizeDistName (#696)', () => {
  it('leaves an already-canonical name alone', () => {
    expect(normalizeDistName('setuptools-scm')).toBe('setuptools-scm');
  });

  it.each([
    ['setuptools_scm', 'an underscore'],
    ['setuptools.scm', 'a dot'],
    ['Setuptools-SCM', 'mixed case'],
    ['setuptools__scm', 'a repeated separator'],
    ['setuptools-_scm', 'mixed repeated separators'],
    ['SETUPTOOLS_SCM', 'upper case with an underscore'],
  ])('normalises %s (%s)', (raw) => {
    expect(normalizeDistName(raw)).toBe('setuptools-scm');
  });

  it('collapses every separator run, not just the first', () => {
    expect(normalizeDistName('setuptools_scm_git_archive')).toBe('setuptools-scm-git-archive');
  });

  it.each([
    ['setuptools-scm>=8', 'a lower-bound specifier'],
    ['setuptools-scm>7', 'a bare >'],
    ['setuptools-scm<9', 'an upper bound'],
    ['setuptools-scm==8.0.4', 'an exact pin'],
    ['setuptools-scm!=7.0', 'an exclusion'],
    ['setuptools-scm~=8.0', 'a compatible-release specifier'],
    ['setuptools-scm[toml]>=8', 'an extras group'],
    ['setuptools-scm(>=8)', 'a parenthesised specifier'],
    ['setuptools-scm (>=8)', 'a spaced parenthesised specifier'],
    ['setuptools-scm;python_version<"3.9"', 'a marker with no leading space'],
    ["setuptools-scm ; python_version < '3.9'", 'a spaced marker'],
    ['setuptools-scm@https://example.invalid/sdist.tar.gz', 'a direct reference'],
    ['setuptools-scm\t>=8', 'a tab'],
    ['  setuptools-scm  ', 'surrounding whitespace'],
  ])('strips %s (%s)', (raw) => {
    expect(normalizeDistName(raw)).toBe('setuptools-scm');
  });

  it('strips a trailing delimiter with nothing after it', () => {
    // The strip pattern is "delimiter, then anything" — `anything` has to
    // include the empty match, or a malformed entry keeps its delimiter and
    // silently fails to match a declared plugin.
    expect(normalizeDistName('setuptools-scm[')).toBe('setuptools-scm');
    expect(normalizeDistName('setuptools-scm>')).toBe('setuptools-scm');
  });

  it('keeps a distinct name distinct', () => {
    // `hatchling` must not normalise to `hatch-vcs`, and a longer name must
    // not normalise to a prefix of itself.
    expect(normalizeDistName('hatchling')).toBe('hatchling');
    expect(normalizeDistName('hatch-vcs-extras')).toBe('hatch-vcs-extras');
  });

  it('returns the empty string for an entry that is only decoration', () => {
    expect(normalizeDistName('>=8')).toBe('');
    expect(normalizeDistName('   ')).toBe('');
  });
});
