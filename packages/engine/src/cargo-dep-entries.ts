/**
 * Every dependency entry declared by a parsed `Cargo.toml`, flattened
 * across the tables cargo resolves. #621.
 *
 * Cargo accepts a dependency in more places than `[dependencies]`, and a
 * stale version requirement in **any** of them fails resolution
 * identically — verified against cargo 1.94.1 for `[dev-dependencies]`,
 * `[build-dependencies]`, `[target.'cfg(…)'.dependencies]` and
 * `[workspace.dependencies]`. A version rewrite that walks only
 * `[dependencies]` therefore still leaves an unbuildable tree, so the
 * flattening happens here, once, rather than at each call site.
 *
 * Pure: takes an already-parsed manifest, touches no I/O.
 */

/** One dependency declaration, normalized to its object form. */
export interface CargoDepEntry {
  /** The key as written — a rename, not necessarily the crate name. */
  key: string;
  /** `path = "…"` as written (relative to the manifest's directory). */
  path?: string | undefined;
  /** True when the entry carries a `version = "…"` requirement. */
  hasVersionReq: boolean;
  /** True when the entry defers to `[workspace.dependencies]`. */
  inheritsFromWorkspace: boolean;
}

interface DepTable {
  [key: string]: unknown;
}

/**
 * Flatten every dependency entry in `parsed`, including target-specific
 * tables and `[workspace.dependencies]`.
 *
 * The shorthand form (`serde = "1"`) can never be a path dependency, so
 * it is reported with no `path` rather than skipped — callers filter on
 * `path` and would otherwise have to re-derive that fact.
 */
export function cargoDepEntries(parsed: unknown): CargoDepEntry[] {
  if (parsed === null || typeof parsed !== 'object') {return [];}
  const root = parsed as Record<string, unknown>;
  const out: CargoDepEntry[] = [];

  for (const table of collectTables(root)) {
    for (const [key, value] of Object.entries(table)) {
      out.push(toEntry(key, value));
    }
  }
  return out;
}

const DEP_TABLE_NAMES = ['dependencies', 'dev-dependencies', 'build-dependencies'] as const;

/** Every dependency-bearing table: top level, per-target, and workspace. */
function collectTables(root: Record<string, unknown>): DepTable[] {
  const tables: DepTable[] = [];

  const push = (v: unknown): void => {
    if (v !== null && typeof v === 'object') {tables.push(v as DepTable);}
  };

  for (const name of DEP_TABLE_NAMES) {push(root[name]);}

  // `[target.'cfg(unix)'.dependencies]` and friends. The cfg expression is
  // an arbitrary string key, so every value under `target` is inspected.
  const target = root['target'];
  if (target !== null && typeof target === 'object') {
    for (const perTarget of Object.values(target as Record<string, unknown>)) {
      if (perTarget === null || typeof perTarget !== 'object') {continue;}
      for (const name of DEP_TABLE_NAMES) {
        push((perTarget as Record<string, unknown>)[name]);
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

function toEntry(key: string, value: unknown): CargoDepEntry {
  // `serde = "1"` — a bare version requirement; never a path dependency.
  if (typeof value === 'string') {
    return { key, hasVersionReq: true, inheritsFromWorkspace: false };
  }
  if (value === null || typeof value !== 'object') {
    return { key, hasVersionReq: false, inheritsFromWorkspace: false };
  }
  const obj = value as Record<string, unknown>;
  const path = typeof obj['path'] === 'string' ? obj['path'] : undefined;
  return {
    key,
    path,
    hasVersionReq: typeof obj['version'] === 'string',
    inheritsFromWorkspace: obj['workspace'] === true,
  };
}
