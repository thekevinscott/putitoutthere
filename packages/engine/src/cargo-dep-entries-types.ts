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

export interface DepTable {
  [key: string]: unknown;
}
