/**
 * Python-version resolution for `kind = "pypi"` packages (#369): explicit
 * `python_versions` in `putitoutthere.toml`, else inferred from
 * `[project].requires-python`, else a single default. The planner fans the pypi
 * build matrix across the set so wheel coverage needs no configuration.
 */

import { join } from 'node:path';

import { compareVersionStrings } from './compare-version-strings.js';
import { expandRequiresPython } from './expand-requires-python.js';
import { readRequiresPython } from './read-requires-python.js';

export async function resolvePythonVersions(
  pkg: { path: string; python_versions?: readonly string[] | undefined },
  cwd: string,
): Promise<string[]> {
  if (pkg.python_versions !== undefined) {
    return [...pkg.python_versions].sort(compareVersionStrings);
  }
  const requiresPython = await readRequiresPython(join(cwd, pkg.path, 'pyproject.toml'));
  if (requiresPython !== null) {
    const expanded = expandRequiresPython(requiresPython);
    if (expanded.length > 0) {return expanded;}
  }
  return ['3.12'];
}
