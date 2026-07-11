/**
 * Detects Python-version-independent maturin wheels so the planner can
 * collapse the per-CPython-version build fan to a single wheel. #401.
 *
 * `kind = "pypi"` `build = "maturin"` normally fans the wheel build
 * across every CPython version `requires-python` allows (see
 * `python-versions.ts`). But two maturin shapes produce ONE wheel per
 * platform that is byte-identical regardless of the interpreter that
 * built it:
 *
 *  - `[tool.maturin].bindings = "bin"` in `pyproject.toml` — the wheel
 *    wraps a Rust *binary*, tagged `py3-none-<platform>`; it carries no
 *    Python ABI at all.
 *  - a pyo3 (or pyo3-ffi) `abi3` / `abi3-pyXY` feature — a single
 *    stable-ABI extension tagged `cp3x-abi3-<platform>` that loads on
 *    every CPython >= X.Y.
 *
 * Fanning either shape across N versions yields N identical wheels:
 * wasted build time, and — because each fanned row uploads under its own
 * artifact — N copies of the same wheel filename that race-corrupt at the
 * consumer's `merge-multiple: true` download (`twine` → `BadZipFile`).
 *
 * Detection is best-effort and conservative. A missing or unparseable
 * manifest, or an abi3 setup we don't recognize (a workspace-inherited
 * `pyo3` dependency, a target-specific `[target.'cfg(...)'.dependencies]`
 * table), falls through to `false` and the planner keeps fanning — the
 * pre-#401 behavior, never worse.
 *
 * Engine convention: synchronous `readFileSync` throughout (AGENTS.md).
 */

import { readFileSync } from 'node:fs';
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
export function isVersionIndependentWheel(pkgPath: string, cwd: string): boolean {
  const pkgDir = join(cwd, pkgPath);
  const pyproject = readTomlOrNull(join(pkgDir, 'pyproject.toml'));
  if (pyprojectMarksVersionIndependent(pyproject)) {return true;}
  return cargoEnablesAbi3(readTomlOrNull(join(pkgDir, 'Cargo.toml')));
}

/* ------------------------------ internals ------------------------------ */

function readTomlOrNull(path: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = parseToml(raw);
    return isTable(parsed) ? parsed : null;
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
