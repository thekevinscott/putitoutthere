/**
 * Does a `pyproject.toml` `[build-system].requires` list declare a given
 * build-time plugin?
 *
 * Needed because a version-source *table* and the plugin that implements
 * it are declared in two different places. `[tool.hatch.version] source =
 * "vcs"` names hatch-vcs's plugin entry point, but hatchling can only
 * resolve it when `hatch-vcs` is in `requires`; without it the build dies
 * with `Unknown version source: vcs` — mid-release, long after the
 * publish has started. Same shape for `[tool.setuptools_scm]` and
 * `setuptools-scm`. Checking the table alone is not enough (#696).
 *
 * `distribution` is a union of the plugin names piot cares about rather
 * than a bare `string` so the caller cannot pass an unnormalised spelling:
 * only the declared entries are normalised, and comparing two normalised
 * values would quietly accept `setuptools_scm` as the needle too.
 *
 * Pure — no I/O, so it stays sync per the engine's async convention.
 */
import { normalizeDistName } from './normalize-dist-name.js';

export function buildRequiresDeclares(
  requires: unknown,
  distribution: 'hatch-vcs' | 'setuptools-scm',
): boolean {
  if (!Array.isArray(requires)) {
    return false;
  }
  return requires.some(
    (entry) => typeof entry === 'string' && normalizeDistName(entry) === distribution,
  );
}
