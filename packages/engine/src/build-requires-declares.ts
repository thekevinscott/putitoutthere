/**
 * Does a `pyproject.toml` `[build-system].requires` list declare a given
 * build-time plugin? `[tool.hatch.version] source = "vcs"` resolves only
 * when `hatch-vcs` is also in `requires`; otherwise the build dies
 * mid-release with `Unknown version source: vcs`. Same for setuptools-scm (#696).
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
