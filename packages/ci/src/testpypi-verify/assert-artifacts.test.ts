/**
 * Pins `decideAssertArtifacts`: the sorted `dist/<name>` listing, the
 * per-prefix sdist-then-wheel guard, the maturin-before-hatch order, the exact
 * `::error::missing ...` lines and exit codes, the `<prefix>-` / suffix
 * boundaries (a similarly-named package must not satisfy a guard), and — #672
 * — the stale-version guard that replaced the TestPyPI duplicate-upload 400.
 */

import { describe, expect, it } from 'vitest';

import { decideAssertArtifacts } from './assert-artifacts.js';

// The throwaway version `piot-ci fixture-materialize plan` stamps on a fixture
// for the run that is about to publish it: `0.0.<unix-seconds>`.
const PLAN_VERSION = '0.0.1700000000';
// What `fixture-materialize build` stamps instead — the stale literal a real
// consumer's lagging manifest carries. Artifacts reaching the TestPyPI upload
// at this version mean the publish path built from the baseline manifest.
const BUILD_BASELINE_VERSION = '0.0.1';

const MATURIN_SDIST = `piot_fixture_zzz_python_maturin-${PLAN_VERSION}.tar.gz`;
const MATURIN_WHEEL = `piot_fixture_zzz_python_maturin-${PLAN_VERSION}-cp312-cp312-manylinux.whl`;
const HATCH_SDIST = `piot_fixture_zzz_python_hatch-${PLAN_VERSION}.tar.gz`;
const HATCH_WHEEL = `piot_fixture_zzz_python_hatch-${PLAN_VERSION}-py3-none-any.whl`;

/** The same four artifacts, restamped at `version`. */
const at = (version: string): string[] =>
  [MATURIN_SDIST, MATURIN_WHEEL, HATCH_SDIST, HATCH_WHEEL].map((name) => name.replace(PLAN_VERSION, version));

describe('decideAssertArtifacts', () => {
  it('lists every dist file sorted as dist/<name> and exits 0 when all artifacts exist', () => {
    const decision = decideAssertArtifacts([MATURIN_WHEEL, MATURIN_SDIST, HATCH_WHEEL, HATCH_SDIST]);
    expect(decision).toEqual({
      lines: [
        `dist/piot_fixture_zzz_python_hatch-${PLAN_VERSION}-py3-none-any.whl`,
        `dist/piot_fixture_zzz_python_hatch-${PLAN_VERSION}.tar.gz`,
        `dist/piot_fixture_zzz_python_maturin-${PLAN_VERSION}-cp312-cp312-manylinux.whl`,
        `dist/piot_fixture_zzz_python_maturin-${PLAN_VERSION}.tar.gz`,
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

/**
 * #672. The TestPyPI job used to upload without `skip-existing`, so a run that
 * rebuilt the fixtures at the `0.0.1` build-mode baseline hit a duplicate-file
 * 400 on the second such run. #669 added `skip-existing` for re-runnability,
 * which turned that canary into a silent pass: twine skips the duplicate, the
 * metadata verify downloads the *previous* run's files, and their embedded
 * version is exactly the one this run expected. These pin the explicit
 * replacement — a pre-upload assertion that the artifacts about to be shipped
 * carry the version this run's plan computed, which fires on the first stale
 * run and does not care what the registry already holds.
 */
describe('decideAssertArtifacts stale-version guard (#672)', () => {
  it('refuses artifacts stamped with the build-mode baseline, after printing the listing', () => {
    const decision = decideAssertArtifacts(at(BUILD_BASELINE_VERSION));
    expect(decision.exitCode).toBe(1);
    expect(decision.lines).toEqual([
      'dist/piot_fixture_zzz_python_hatch-0.0.1-py3-none-any.whl',
      'dist/piot_fixture_zzz_python_hatch-0.0.1.tar.gz',
      'dist/piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-manylinux.whl',
      'dist/piot_fixture_zzz_python_maturin-0.0.1.tar.gz',
      '::error::piot-fixture-zzz-python-maturin artifacts carry version 0.0.1, not the plan-computed 0.0.<epoch> version this run stamped — refusing to upload a stale build to TestPyPI (#672)',
    ]);
  });

  it('names the hatch project when only its artifacts are stale', () => {
    const decision = decideAssertArtifacts([
      MATURIN_SDIST,
      MATURIN_WHEEL,
      HATCH_SDIST.replace(PLAN_VERSION, BUILD_BASELINE_VERSION),
      HATCH_WHEEL.replace(PLAN_VERSION, BUILD_BASELINE_VERSION),
    ]);
    expect(decision.exitCode).toBe(1);
    expect(decision.lines.at(-1)).toBe(
      '::error::piot-fixture-zzz-python-hatch artifacts carry version 0.0.1, not the plan-computed 0.0.<epoch> version this run stamped — refusing to upload a stale build to TestPyPI (#672)',
    );
  });

  it('refuses a version no plan phase could have produced, not just the baseline literal', () => {
    // What hatch-vcs derives from the throwaway git repo when
    // SETUPTOOLS_SCM_PRETEND_VERSION goes missing: a real, fresh-looking
    // version that is nonetheless not the one the plan published a tag for.
    const decision = decideAssertArtifacts(at('0.1.dev1+g1234567'));
    expect(decision.exitCode).toBe(1);
    expect(decision.lines.at(-1)).toBe(
      '::error::piot-fixture-zzz-python-maturin artifacts carry version 0.1.dev1+g1234567, not the plan-computed 0.0.<epoch> version this run stamped — refusing to upload a stale build to TestPyPI (#672)',
    );
  });

  it('refuses a project whose sdist and wheel disagree on the version', () => {
    const decision = decideAssertArtifacts([
      MATURIN_SDIST.replace(PLAN_VERSION, BUILD_BASELINE_VERSION),
      MATURIN_WHEEL,
      HATCH_SDIST,
      HATCH_WHEEL,
    ]);
    expect(decision.exitCode).toBe(1);
    expect(decision.lines.at(-1)).toBe(
      "::error::expected exactly one version for piot-fixture-zzz-python-maturin, found ['0.0.1', '0.0.1700000000']",
    );
  });

  it('exits 0 when every project is stamped with a plan-computed version', () => {
    const decision = decideAssertArtifacts(at(PLAN_VERSION));
    expect(decision.exitCode).toBe(0);
    expect(decision.lines.every((line) => line.startsWith('dist/'))).toBe(true);
  });
});
