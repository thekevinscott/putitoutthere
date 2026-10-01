/**
 * Does a fixture artifact's version look like one the *plan* phase stamped for
 * this run? `piot-ci fixture-materialize plan` writes `0.0.<unix-seconds>`
 * (see `fixture-materialize/run.ts`), while its `build` mode writes the fixed
 * `0.0.1` baseline so a build-only run needs no clock. Anything reaching the
 * TestPyPI upload must carry the former: the baseline means the publish job is
 * about to re-upload a stale build, and a shape outside `0.0.<digits>`
 * (hatch-vcs' `0.1.dev1+g<sha>`, say) means the version came from somewhere
 * other than the plan at all. Pure. (#672)
 */

const BUILD_BASELINE_VERSION = '0.0.1';

export function isPlanFixtureVersion(version: string): boolean {
  return /^0\.0\.\d+$/.test(version) && version !== BUILD_BASELINE_VERSION;
}
