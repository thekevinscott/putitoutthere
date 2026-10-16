import type { CargoDepEntry } from './cargo-dep-entries-types.js';

export function toCargoDepEntry(key: string, value: unknown): CargoDepEntry {
  // `serde = "1"` — a bare version requirement; never a path dependency.
  if (typeof value === 'string') {
    return { key, hasVersionReq: true, inheritsFromWorkspace: false };
  }
  const obj = (value ?? {}) as Record<string, unknown>;
  const path = typeof obj['path'] === 'string' ? obj['path'] : undefined;
  return {
    key,
    path,
    hasVersionReq: typeof obj['version'] === 'string',
    inheritsFromWorkspace: obj['workspace'] === true,
  };
}
