import { featuresEnableAbi3 } from './features-enable-abi3.js';
import { isTable } from './is-table.js';
import { tableAt } from './table-at.js';

/**
 * The crate enables abi3 via a `features` array on its `pyo3` /
 * `pyo3-ffi` dependency in `[dependencies]`.
 */
export function cargoEnablesAbi3(cargo: Record<string, unknown> | null): boolean {
  const deps = tableAt(cargo, ['dependencies']);
  if (deps === null) {return false;}
  for (const crate of ['pyo3', 'pyo3-ffi']) {
    const dep = deps[crate];
    if (isTable(dep) && featuresEnableAbi3(dep.features)) {return true;}
  }
  return false;
}
