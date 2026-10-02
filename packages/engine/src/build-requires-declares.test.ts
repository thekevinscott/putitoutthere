import { describe, expect, it } from 'vitest';

import { buildRequiresDeclares } from './build-requires-declares.js';

describe('buildRequiresDeclares (#696)', () => {
  it('finds a bare name among several entries', () => {
    expect(buildRequiresDeclares(['hatchling', 'hatch-vcs'], 'hatch-vcs')).toBe(true);
  });

  it('finds a decorated, differently-spelled name', () => {
    expect(buildRequiresDeclares(['setuptools>=61', 'setuptools_scm>=8'], 'setuptools-scm')).toBe(
      true,
    );
  });

  it('does not match a name that is merely a prefix of a declared one', () => {
    // `hatchling` starts with `hatch`, and `hatch-vcs` is not declared; a
    // `startsWith`/`includes` lookup would wrongly accept this.
    expect(buildRequiresDeclares(['hatchling'], 'hatch-vcs')).toBe(false);
  });

  it('does not match a name that merely contains the wanted one', () => {
    expect(buildRequiresDeclares(['hatch-vcs-extras'], 'hatch-vcs')).toBe(false);
  });

  it('returns false when requires is absent or not an array', () => {
    // A pyproject with no [build-system] table at all reaches here as
    // `undefined`; the engine deliberately tolerates that, so this must
    // report "not declared" rather than throw.
    expect(buildRequiresDeclares(undefined, 'hatch-vcs')).toBe(false);
    expect(buildRequiresDeclares('hatch-vcs', 'hatch-vcs')).toBe(false);
    expect(buildRequiresDeclares({ 0: 'hatch-vcs' }, 'hatch-vcs')).toBe(false);
    expect(buildRequiresDeclares([], 'hatch-vcs')).toBe(false);
  });

  it('skips non-string entries without throwing', () => {
    expect(buildRequiresDeclares([null, 42, {}, 'hatch-vcs'], 'hatch-vcs')).toBe(true);
    expect(buildRequiresDeclares([null, 42, {}], 'hatch-vcs')).toBe(false);
  });

  it('distinguishes the two plugins it is asked about', () => {
    expect(buildRequiresDeclares(['hatchling', 'hatch-vcs'], 'setuptools-scm')).toBe(false);
    expect(buildRequiresDeclares(['setuptools', 'setuptools-scm'], 'hatch-vcs')).toBe(false);
  });
});
