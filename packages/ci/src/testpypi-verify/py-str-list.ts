/**
 * Reproduce Python's `repr()` of a list of strings — the shape the bash
 * printed with `found {sorted(versions)}` and `found {metadata_paths}`
 * (`['a', 'b']`, or `[]` when empty). Each element is rendered with `pyRepr`,
 * matching CPython's per-element `repr`. Pure.
 */

import { pyRepr } from './py-repr.js';

export function pyStrList(items: readonly string[]): string {
  return `[${items.map((item) => pyRepr(item)).join(', ')}]`;
}
