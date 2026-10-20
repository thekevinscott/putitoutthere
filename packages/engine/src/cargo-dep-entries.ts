/**
 * Every dependency entry declared by a parsed `Cargo.toml`, flattened across
 * the tables cargo resolves (#621). A stale version requirement in
 * `[dev-dependencies]`, `[build-dependencies]`, `[target.'cfg(…)'.dependencies]`
 * or `[workspace.dependencies]` fails resolution identically.
 */

import type { CargoDepEntry } from './cargo-dep-entries-types.js';
import { collectDepTables } from './collect-dep-tables.js';
import { toCargoDepEntry } from './to-cargo-dep-entry.js';

export type { CargoDepEntry } from './cargo-dep-entries-types.js';

/**
 * Flatten every dependency entry in `parsed`, including target-specific
 * tables and `[workspace.dependencies]`.
 *
 * The shorthand form (`serde = "1"`) can never be a path dependency, so
 * it is reported with no `path` rather than skipped — callers filter on
 * `path` and would otherwise have to re-derive that fact.
 */
export function cargoDepEntries(parsed: unknown): CargoDepEntry[] {
  // `?? {}` rather than a type guard: a primitive yields `undefined` for
  // every lookup below, so only null/undefined need substituting, and the
  // extra `typeof` arm a guard would carry could never change an outcome.
  const root = (parsed ?? {}) as Record<string, unknown>;
  const out: CargoDepEntry[] = [];

  for (const table of collectDepTables(root)) {
    for (const [key, value] of Object.entries(table)) {
      out.push(toCargoDepEntry(key, value));
    }
  }
  return out;
}
