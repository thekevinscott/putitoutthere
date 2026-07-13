/**
 * Pins `buildRequirements`: one `name==version` per fixture package (maturin
 * before hatch), the version read from either an sdist (removeprefix/suffix) or
 * a wheel (segment after `{stem}-`), the exact "expected exactly one version"
 * error for zero/two versions, and the `{stem}-` prefix boundary.
 */

import { describe, expect, it } from 'vitest';

import { buildRequirements } from './build-requirements.js';

const MATURIN_SDIST = 'piot_fixture_zzz_python_maturin-0.0.1.tar.gz';
const MATURIN_WHEEL = 'piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-manylinux.whl';
const HATCH_SDIST = 'piot_fixture_zzz_python_hatch-0.0.1.tar.gz';
const HATCH_WHEEL = 'piot_fixture_zzz_python_hatch-0.0.1-py3-none-any.whl';

describe('buildRequirements', () => {
  it('pins one requirement per package, maturin before hatch', () => {
    expect(buildRequirements([MATURIN_SDIST, MATURIN_WHEEL, HATCH_SDIST, HATCH_WHEEL])).toEqual({
      requirements: ['piot-fixture-zzz-python-maturin==0.0.1', 'piot-fixture-zzz-python-hatch==0.0.1'],
    });
  });

  it('reads the version from an sdist basename (removeprefix + removesuffix)', () => {
    expect(buildRequirements([MATURIN_SDIST, HATCH_SDIST])).toEqual({
      requirements: ['piot-fixture-zzz-python-maturin==0.0.1', 'piot-fixture-zzz-python-hatch==0.0.1'],
    });
  });

  it('reads the version from a wheel basename (segment after the stem)', () => {
    expect(buildRequirements([MATURIN_WHEEL, HATCH_WHEEL])).toEqual({
      requirements: ['piot-fixture-zzz-python-maturin==0.0.1', 'piot-fixture-zzz-python-hatch==0.0.1'],
    });
  });

  it('reads a wheel version segment with no further dash (matching split("-")[1])', () => {
    // The bash's `name.split("-")[1]` takes the whole remainder after the stem
    // when there is no further dash — so a dashless `<stem>-7.7.7.whl` yields
    // the literal `7.7.7.whl`. Real wheels always carry the python/abi tags, so
    // this edge only pins the no-dash branch, byte-faithful to the bash.
    expect(buildRequirements(['piot_fixture_zzz_python_maturin-7.7.7.whl', HATCH_SDIST])).toEqual({
      requirements: ['piot-fixture-zzz-python-maturin==7.7.7.whl', 'piot-fixture-zzz-python-hatch==0.0.1'],
    });
  });

  it('ignores a prefix-matching file that is neither an sdist nor a wheel', () => {
    // The bash's if/elif over `{stem}-*` only reads `.tar.gz` / `.whl`; a stray
    // signature or metadata file is a no-op.
    expect(
      buildRequirements([
        MATURIN_SDIST,
        MATURIN_WHEEL,
        'piot_fixture_zzz_python_maturin-0.0.1.tar.gz.asc',
        HATCH_SDIST,
        HATCH_WHEEL,
      ]),
    ).toEqual({
      requirements: ['piot-fixture-zzz-python-maturin==0.0.1', 'piot-fixture-zzz-python-hatch==0.0.1'],
    });
  });

  it('errors with found [] when a package has no artifacts', () => {
    expect(buildRequirements([HATCH_SDIST, HATCH_WHEEL])).toEqual({
      errorLine: 'expected exactly one version for piot-fixture-zzz-python-maturin, found []',
    });
  });

  it('errors with the sorted version list when a package has two versions', () => {
    expect(
      buildRequirements([MATURIN_SDIST, 'piot_fixture_zzz_python_maturin-0.0.2-cp312-cp312-manylinux.whl']),
    ).toEqual({
      errorLine: "expected exactly one version for piot-fixture-zzz-python-maturin, found ['0.0.1', '0.0.2']",
    });
  });

  it('requires the {stem}- boundary: a similarly-named package is ignored', () => {
    // "maturine" starts with the maturin stem but not "maturin-"; without the
    // boundary it would inject a spurious extra version.
    expect(
      buildRequirements([
        MATURIN_SDIST,
        MATURIN_WHEEL,
        'piot_fixture_zzz_python_maturine-9.9.9.tar.gz',
        HATCH_SDIST,
        HATCH_WHEEL,
      ]),
    ).toEqual({
      requirements: ['piot-fixture-zzz-python-maturin==0.0.1', 'piot-fixture-zzz-python-hatch==0.0.1'],
    });
  });
});
