/**
 * Detect Python-version-independent maturin wheels so the planner collapses the
 * per-CPython build fan to one wheel (#401): `[tool.maturin].bindings = "bin"` or
 * a pyo3 `abi3` feature. Fanning either yields N identical wheel filenames that
 * race-corrupt under `merge-multiple: true` (`twine` → `BadZipFile`); anything
 * unrecognised falls through to `false` and keeps fanning.
 */

import { join } from 'node:path';

import { cargoEnablesAbi3 } from './cargo-enables-abi3.js';
import { pyprojectMarksVersionIndependent } from './pyproject-marks-version-independent.js';
import { readToml } from './read-toml.js';

/**
 * True when the maturin wheel for the package at `cwd/pkgPath` is
 * Python-version-independent and so should be built once rather than
 * fanned across the resolved CPython set.
 */
export async function isVersionIndependentWheel(pkgPath: string, cwd: string): Promise<boolean> {
  const pkgDir = join(cwd, pkgPath);
  const pyproject = await readToml(join(pkgDir, 'pyproject.toml'));
  if (pyprojectMarksVersionIndependent(pyproject)) {return true;}
  return cargoEnablesAbi3(await readToml(join(pkgDir, 'Cargo.toml')));
}
