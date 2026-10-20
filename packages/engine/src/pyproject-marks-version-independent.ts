import { featuresEnableAbi3 } from './features-enable-abi3.js';
import { tableAt } from './table-at.js';

/**
 * pyproject signals version independence via `[tool.maturin].bindings =
 * "bin"` (a Rust-binary wheel) or a `[tool.maturin].features` entry that
 * enables a pyo3 abi3 feature (e.g. `pyo3/abi3-py38`).
 */
export function pyprojectMarksVersionIndependent(pyproject: Record<string, unknown> | null): boolean {
  const maturin = tableAt(pyproject, ['tool', 'maturin']);
  if (maturin === null) {return false;}
  if (maturin.bindings === 'bin') {return true;}
  return featuresEnableAbi3(maturin.features);
}
