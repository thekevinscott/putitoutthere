/**
 * Does a `pyproject.toml` `[build-system].requires` list declare a given
 * build-time distribution?
 *
 * Needed because a version-source *table* and the plugin that implements
 * it are declared in two different places. `[tool.hatch.version] source =
 * "vcs"` names hatch-vcs's plugin entry point, but hatchling can only
 * resolve it when `hatch-vcs` is in `requires`; without it the build dies
 * with `Unknown version source: vcs` — mid-release, long after the
 * publish has started. Same shape for `[tool.setuptools_scm]` and
 * `setuptools-scm`. Checking the table alone is not enough (#696).
 *
 * Matching follows PEP 503 name normalisation, because a requirement
 * string is a name plus decoration: `"setuptools_scm>=8"`,
 * `"setuptools[core]>=61"`, `"hatch-vcs ; python_version < '3.9'"` and
 * `"hatch_vcs"` all name distributions a plain `includes()` would miss.
 * The name is everything before the first specifier/extra/marker
 * character; `-`, `_` and `.` runs collapse to `-` and case is folded.
 *
 * Pure — no I/O, so it stays sync per the engine's async convention.
 */
export function buildRequiresDeclares(requires: unknown, distribution: string): boolean {
  if (!Array.isArray(requires)) {
    return false;
  }
  const wanted = normalizeDistName(distribution);
  return requires.some(
    (entry) =>
      typeof entry === 'string' &&
      normalizeDistName(entry.trim().replace(/[\s<>=!~;@[(][\s\S]*$/, '')) === wanted,
  );
}

/** PEP 503 normalisation: case-folded, with `-`/`_`/`.` runs collapsed to `-`. */
function normalizeDistName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[-_.]+/g, '-');
}
