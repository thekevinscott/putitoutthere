import type { DepTable } from './cargo-dep-entries-types.js';

/** Every dependency-bearing table: top level, per-target, and workspace. */
export function collectDepTables(root: Record<string, unknown>): DepTable[] {
  const depTableNames = ['dependencies', 'dev-dependencies', 'build-dependencies'] as const;
  const tables: DepTable[] = [];

  const push = (v: unknown): void => {
    if (v !== null && typeof v === 'object') {tables.push(v as DepTable);}
  };

  for (const name of depTableNames) {push(root[name]);}

  // `[target.'cfg(unix)'.dependencies]` and friends. The cfg expression is
  // an arbitrary string key, so every value under `target` is inspected.
  const target = root['target'];
  if (target !== null && typeof target === 'object') {
    for (const perTarget of Object.values(target as Record<string, unknown>)) {
      const tables_ = (perTarget ?? {}) as Record<string, unknown>;
      for (const name of depTableNames) {
        push(tables_[name]);
      }
    }
  }

  // `[workspace.dependencies]` — where an inheriting member's requirement
  // actually lives, so the rewrite has to reach it.
  const workspace = root['workspace'];
  if (workspace !== null && typeof workspace === 'object') {
    push((workspace as Record<string, unknown>)['dependencies']);
  }

  return tables;
}
