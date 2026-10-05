/**
 * Does a fixture artifact's version look like one the *plan* phase stamped for
 * this run? `fixture-materialize plan` writes `0.0.<unix-seconds>`; its `build`
 * mode writes the fixed `0.0.1` baseline. That baseline reaching a TestPyPI
 * upload means the publish job is about to re-upload a stale build. Pure. (#672)
 */

export function isPlanFixtureVersion(version: string): boolean {
  // Function-scope, not module-scope: a module-level initializer runs once at
  // import time, before the mutation runner can activate a mutant on it, so a
  // constant up there is unkillable by any assertion in here.
  const buildBaselineVersion = '0.0.1';
  return /^0\.0\.\d+$/.test(version) && version !== buildBaselineVersion;
}
