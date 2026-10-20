import type { Package } from './config.js';
import type { MatrixRow } from './plan.js';

export function groupByPackage(
  rows: readonly MatrixRow[],
  _packages: readonly Package[],
): Map<string, MatrixRow[]> {
  const out = new Map<string, MatrixRow[]>();
  for (const r of rows) {
    const arr = out.get(r.name) ?? [];
    arr.push(r);
    out.set(r.name, arr);
  }
  return out;
}
