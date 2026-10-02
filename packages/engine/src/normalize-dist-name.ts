/**
 * The canonical distribution name a `[build-system].requires` entry names: the
 * text before the first specifier, extra, marker or direct-reference char, then
 * PEP 503-normalised (case-folded, runs of `-`/`_`/`.` collapsed to `-`), which
 * is what makes `setuptools_scm` and `Setuptools-SCM` the same name (#696).
 */
export function normalizeDistName(requirement: string): string {
  return requirement
    .trim()
    .replace(/[\s<>=!~;@[(][\s\S]*/, '')
    .toLowerCase()
    .replace(/[-_.]+/g, '-');
}
