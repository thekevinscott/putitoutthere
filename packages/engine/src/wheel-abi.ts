/**
 * Detect Python-version-independent maturin wheels so the planner collapses the
 * per-CPython build fan to one wheel (#401): `[tool.maturin].bindings = "bin"` or
 * a pyo3 `abi3` feature. Fanning either yields N identical wheel filenames that
 * race-corrupt under `merge-multiple: true` (`twine` → `BadZipFile`); anything
 * unrecognised falls through to `false` and keeps fanning.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

// `abi3` or `abi3-py<minor>`, either as a bare Cargo feature on the pyo3
// dependency or as the tail of a `pyo3/abi3…` entry in
// `[tool.maturin].features`.
const ABI3_FEATURE_RE = /(?:^|\/)abi3(?:-py\d+)?$/;

/**
 * True when the maturin wheel for the package at `cwd/pkgPath` is
 * Python-version-independent and so should be built once rather than
 * fanned across the resolved CPython set.
 */
export async function isVersionIndependentWheel(pkgPath: string, cwd: string): Promise<boolean> {
  const pkgDir = join(cwd, pkgPath);
  const pyproject = await readTomlOrNull(join(pkgDir, 'pyproject.toml'));
  if (pyprojectMarksVersionIndependent(pyproject)) {return true;}
  return cargoEnablesAbi3(await readTomlOrNull(join(pkgDir, 'Cargo.toml')));
}

/* ------------------------------ internals ------------------------------ */

async function readTomlOrNull(path: string): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = parseToml(raw);
    /* v8 ignore start -- smol-toml parses every valid document to a table root; the non-table fallback can't fire */
    return isTable(parsed) ? parsed : null;
    /* v8 ignore stop */
  } catch {
    return null;
  }
}

/**
 * pyproject signals version independence via `[tool.maturin].bindings =
 * "bin"` (a Rust-binary wheel) or a `[tool.maturin].features` entry that
 * enables a pyo3 abi3 feature (e.g. `pyo3/abi3-py38`).
 */
function pyprojectMarksVersionIndependent(pyproject: Record<string, unknown> | null): boolean {
  const maturin = tableAt(pyproject, ['tool', 'maturin']);
  if (maturin === null) {return false;}
  if (maturin.bindings === 'bin') {return true;}
  return featuresEnableAbi3(maturin.features);
}

/**
 * The crate enables abi3 via a `features` array on its `pyo3` /
 * `pyo3-ffi` dependency in `[dependencies]`.
 */
function cargoEnablesAbi3(cargo: Record<string, unknown> | null): boolean {
  const deps = tableAt(cargo, ['dependencies']);
  if (deps === null) {return false;}
  for (const crate of ['pyo3', 'pyo3-ffi']) {
    const dep = deps[crate];
    if (isTable(dep) && featuresEnableAbi3(dep.features)) {return true;}
  }
  return false;
}

function featuresEnableAbi3(features: unknown): boolean {
  return (
    Array.isArray(features) &&
    features.some((f) => typeof f === 'string' && ABI3_FEATURE_RE.test(f))
  );
}

/** Walk a dotted table path, returning the nested table or null. */
function tableAt(
  root: Record<string, unknown> | null,
  path: string[],
): Record<string, unknown> | null {
  let cur: unknown = root;
  for (const key of path) {
    if (!isTable(cur)) {return null;}
    cur = cur[key];
  }
  return isTable(cur) ? cur : null;
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
