/**
 * Derivation tests. The expectation is what makes `reconcile --expect`
 * able to fail at all, so every way of producing a *narrower* one than the
 * upload actually shipped has to be an error rather than a quiet omission.
 */

import { describe, expect, it } from 'vitest';

import { decideUploadedExpectations } from './uploaded-expectations.js';

const VERSION = '0.0.1700000000';

describe('decideUploadedExpectations', () => {
  it('collapses every artifact of a project into one expectation', () => {
    expect(
      decideUploadedExpectations([
        `piot_fixture_zzz_python_maturin-${VERSION}.tar.gz`,
        `piot_fixture_zzz_python_maturin-${VERSION}-cp312-abi3-manylinux_2_28_x86_64.whl`,
        `piot_fixture_zzz_python_maturin-${VERSION}-cp312-abi3-macosx_11_0_arm64.whl`,
      ]),
    ).toEqual({
      expectations: [
        {
          name: 'piot-fixture-zzz-python-maturin',
          version: VERSION,
          tag: `piot-fixture-zzz-python-maturin-v${VERSION}`,
        },
      ],
    });
  });

  it('orders projects by name regardless of the order dist/ was read in', () => {
    const decided = decideUploadedExpectations([
      `zzz_last-${VERSION}.tar.gz`,
      `aaa_first-${VERSION}.tar.gz`,
    ]);
    expect('expectations' in decided && decided.expectations.map((e) => e.name)).toEqual([
      'aaa-first',
      'zzz-last',
    ]);
  });

  it('skips the first-publish artifacts pypi-publish discarded before upload', () => {
    // They never reached PyPI (#294), so expecting them would hard-fail
    // reconcile on a version that is genuinely absent.
    const decided = decideUploadedExpectations([
      `piot_fixture_zzz_python_hatch-${VERSION}.tar.gz`,
      `piot_fixture_zzz_python_placeholder-${VERSION}.tar.gz`,
      `piot_fixture_zzz_maturin_ws_placeholder-${VERSION}-cp312-abi3-linux_x86_64.whl`,
    ]);
    expect('expectations' in decided && decided.expectations.map((e) => e.name)).toEqual([
      'piot-fixture-zzz-python-hatch',
    ]);
  });

  it('refuses a project whose artifacts disagree on a version', () => {
    const decided = decideUploadedExpectations([
      `piot_fixture_zzz_python_hatch-${VERSION}.tar.gz`,
      'piot_fixture_zzz_python_hatch-0.0.9-py3-none-any.whl',
    ]);
    expect(decided).toEqual({
      errorLine: `pypi-tag-verify: piot-fixture-zzz-python-hatch artifacts carry both ${VERSION} and 0.0.9 — exactly one version per project is expected`,
    });
  });

  it('refuses a filename it cannot parse rather than skipping it', () => {
    expect(decideUploadedExpectations(['notes.txt'])).toEqual({
      errorLine: 'pypi-tag-verify: dist/notes.txt is not a wheel or sdist filename',
    });
  });

  it('refuses an empty expectation', () => {
    // An empty `--expect` is a silent no-op downstream, so a dist/ with
    // nothing uploadable has to fail here instead.
    expect(decideUploadedExpectations([`only_placeholder-${VERSION}.tar.gz`])).toEqual({
      errorLine:
        'pypi-tag-verify: dist/ holds no uploadable wheel or sdist, but have_pypi reported a PyPI upload',
    });
  });
});
