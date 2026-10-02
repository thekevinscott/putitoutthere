/**
 * The canonical distribution name a `[build-system].requires` entry names.
 *
 * A requirement string is a name plus decoration — `"setuptools_scm>=8"`,
 * `"setuptools-scm[toml]>=8"`, `"hatch-vcs ; python_version < '3.9'"`,
 * `"pkg@https://example/sdist.tar.gz"` — so the name is everything before
 * the first specifier, extra, marker, or direct-reference character. That
 * name is then normalised per PEP 503: case-folded, with runs of `-`, `_`
 * and `.` collapsed to a single `-`, which is what makes `setuptools_scm`
 * and `Setuptools-SCM` the same distribution as `setuptools-scm` (#696).
 *
 * Returns the empty string for an entry that is nothing but decoration.
 *
 * Pure — no I/O, so it stays sync per the engine's async convention.
 */
export function normalizeDistName(requirement: string): string {
  return requirement
    .trim()
    .replace(/[\s<>=!~;@[(][\s\S]*/, '')
    .toLowerCase()
    .replace(/[-_.]+/g, '-');
}
