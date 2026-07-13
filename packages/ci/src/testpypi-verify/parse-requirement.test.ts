/**
 * Pins `parseRequirement`: split on the first `==` into package/version, and
 * derive the underscore stem from the dashed package name.
 */

import { describe, expect, it } from 'vitest';

import { parseRequirement } from './parse-requirement.js';

describe('parseRequirement', () => {
  it('splits name==version and derives the underscore stem', () => {
    expect(parseRequirement('piot-fixture-zzz-python-maturin==0.0.1')).toEqual({
      package: 'piot-fixture-zzz-python-maturin',
      version: '0.0.1',
      stem: 'piot_fixture_zzz_python_maturin',
    });
  });

  it('splits on the first == only', () => {
    expect(parseRequirement('pkg==1.0==beta')).toEqual({ package: 'pkg', version: '1.0==beta', stem: 'pkg' });
  });
});
