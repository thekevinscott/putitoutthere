/**
 * Filename grammar tests. The field-count guards are the load-bearing part:
 * a loose parse would read a version off a filename shape it does not
 * understand and expect PyPI to confirm a version nobody published.
 */

import { describe, expect, it } from 'vitest';

import { parseDistribution } from './parse-distribution.js';

describe('parseDistribution', () => {
  it('reads an sdist, unescaping the name half', () => {
    expect(parseDistribution('piot_fixture_zzz_python_hatch-0.0.1700000000.tar.gz')).toEqual({
      project: 'piot-fixture-zzz-python-hatch',
      version: '0.0.1700000000',
    });
  });

  it('reads a five-field wheel', () => {
    expect(
      parseDistribution('piot_fixture_zzz_python_maturin-0.0.1-cp312-abi3-manylinux_2_28_x86_64.whl'),
    ).toEqual({ project: 'piot-fixture-zzz-python-maturin', version: '0.0.1' });
  });

  it('reads a six-field wheel, whose extra field is the build tag', () => {
    expect(parseDistribution('pkg-1.2.3-7-py3-none-any.whl')).toEqual({
      project: 'pkg',
      version: '1.2.3',
    });
  });

  it('lowercases the project name', () => {
    expect(parseDistribution('Piot_Fixture-1.0.tar.gz')?.project).toBe('piot-fixture');
  });

  it.each([
    ['an sdist with a stray extra field', 'pkg-1.0-extra.tar.gz'],
    ['an sdist with no version', 'pkg.tar.gz'],
    ['a wheel with too few fields', 'pkg-1.0-none-any.whl'],
    ['a wheel with too many fields', 'pkg-1.0-7-py3-none-any-extra.whl'],
    ['an empty project name', '-1.0.tar.gz'],
    ['an empty version', 'pkg-.tar.gz'],
    ['a file that is neither', 'pkg-1.0.zip'],
  ])('returns null for %s', (_label, filename) => {
    expect(parseDistribution(filename)).toBeNull();
  });
});
