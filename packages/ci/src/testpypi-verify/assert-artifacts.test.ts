/**
 * Pins `decideAssertArtifacts`: the sorted `dist/<name>` listing, the
 * per-prefix sdist-then-wheel guard, the maturin-before-hatch order, the exact
 * `::error::missing ...` lines and exit codes, and the `<prefix>-` / suffix
 * boundaries (a similarly-named package must not satisfy a guard).
 */

import { describe, expect, it } from 'vitest';

import { decideAssertArtifacts } from './assert-artifacts.js';

const MATURIN_SDIST = 'piot_fixture_zzz_python_maturin-0.0.1.tar.gz';
const MATURIN_WHEEL = 'piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-manylinux.whl';
const HATCH_SDIST = 'piot_fixture_zzz_python_hatch-0.0.1.tar.gz';
const HATCH_WHEEL = 'piot_fixture_zzz_python_hatch-0.0.1-py3-none-any.whl';

describe('decideAssertArtifacts', () => {
  it('lists every dist file sorted as dist/<name> and exits 0 when all artifacts exist', () => {
    const decision = decideAssertArtifacts([MATURIN_WHEEL, MATURIN_SDIST, HATCH_WHEEL, HATCH_SDIST]);
    expect(decision).toEqual({
      lines: [
        'dist/piot_fixture_zzz_python_hatch-0.0.1-py3-none-any.whl',
        'dist/piot_fixture_zzz_python_hatch-0.0.1.tar.gz',
        'dist/piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-manylinux.whl',
        'dist/piot_fixture_zzz_python_maturin-0.0.1.tar.gz',
      ],
      exitCode: 0,
    });
  });

  it('fails on a missing maturin sdist before checking hatch', () => {
    const decision = decideAssertArtifacts([MATURIN_WHEEL, HATCH_WHEEL, HATCH_SDIST]);
    expect(decision.exitCode).toBe(1);
    expect(decision.lines.at(-1)).toBe('::error::missing piot_fixture_zzz_python_maturin sdist artifact for TestPyPI');
  });

  it('fails on a missing maturin wheel when its sdist exists', () => {
    const decision = decideAssertArtifacts([MATURIN_SDIST, HATCH_WHEEL, HATCH_SDIST]);
    expect(decision.exitCode).toBe(1);
    expect(decision.lines.at(-1)).toBe('::error::missing piot_fixture_zzz_python_maturin wheel artifact for TestPyPI');
  });

  it('fails on a missing hatch sdist once maturin is complete', () => {
    const decision = decideAssertArtifacts([MATURIN_WHEEL, MATURIN_SDIST, HATCH_WHEEL]);
    expect(decision.exitCode).toBe(1);
    expect(decision.lines.at(-1)).toBe('::error::missing piot_fixture_zzz_python_hatch sdist artifact for TestPyPI');
  });

  it('fails on a missing hatch wheel once maturin is complete', () => {
    const decision = decideAssertArtifacts([MATURIN_WHEEL, MATURIN_SDIST, HATCH_SDIST]);
    expect(decision.exitCode).toBe(1);
    expect(decision.lines.at(-1)).toBe('::error::missing piot_fixture_zzz_python_hatch wheel artifact for TestPyPI');
  });

  it('requires the <prefix>- boundary: a similarly-named package does not satisfy the maturin guard', () => {
    // "maturine" starts with the maturin prefix but not "maturin-", so a
    // boundary-less prefix match would wrongly treat these as maturin.
    const decision = decideAssertArtifacts([
      'piot_fixture_zzz_python_maturine-9.9.9.tar.gz',
      'piot_fixture_zzz_python_maturine-9.9.9-py3-none-any.whl',
      HATCH_SDIST,
      HATCH_WHEEL,
    ]);
    expect(decision.exitCode).toBe(1);
    expect(decision.lines.at(-1)).toBe('::error::missing piot_fixture_zzz_python_maturin sdist artifact for TestPyPI');
  });
});
