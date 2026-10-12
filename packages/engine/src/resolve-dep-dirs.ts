/**
 * Resolve a manifest's dependency entries to the directories they point at
 * (#621). Two indirections, either silently dropping a crate: `.workspace = true`
 * moves both `path` and the requirement into the root's `[workspace.dependencies]`,
 * and `path` is relative to the *declaring* manifest's dir — the root, if inherited.
 */

import { cargoDepEntries } from './cargo-dep-entries.js';
import { absolute, workspaceDepDirs } from './workspace-dep-dirs.js';

/** A dependency entry that resolves to a directory on disk. */
export interface ResolvedDepDir {
  /** The dependency key as written in the manifest being rewritten. */
  key: string;
  /** Absolute directory of the dependency crate. */
  dir: string;
  /** True when the entry carries a `version = "…"` requirement. */
  hasVersionReq: boolean;
  /**
   * True when the requirement lives in the workspace root rather than in
   * this manifest — the rewrite has to target the root's file instead.
   */
  inheritsFromWorkspace: boolean;
}

/**
 * Every path dependency declared by `parsed`, resolved to an absolute
 * directory. Registry dependencies are omitted — they have no directory
 * and must never be rewritten.
 *
 * `workspaceParsed` is the parsed workspace-root manifest (or `null` when
 * there is no workspace); it supplies `[workspace.dependencies]` for
 * inheriting entries.
 */
export function resolveDepDirs(
  parsed: unknown,
  manifestDir: string,
  workspaceParsed: unknown,
  workspaceRoot: string | null,
): ResolvedDepDir[] {
  // Only consult the workspace table when there is a root to resolve its
  // relative paths against; an empty map then makes every inherited lookup
  // miss, so no separate null check is needed per entry.
  const inherited =
    workspaceRoot === null
      ? new Map<string, { dir: string; hasVersionReq: boolean }>()
      : workspaceDepDirs(workspaceParsed, workspaceRoot);
  const out: ResolvedDepDir[] = [];

  for (const entry of cargoDepEntries(parsed)) {
    if (entry.path !== undefined) {
      out.push({
        key: entry.key,
        dir: absolute(entry.path, manifestDir),
        hasVersionReq: entry.hasVersionReq,
        inheritsFromWorkspace: false,
      });
      continue;
    }
    if (!entry.inheritsFromWorkspace) {continue;}
    const ws = inherited.get(entry.key);
    if (ws === undefined) {continue;}
    out.push({
      key: entry.key,
      dir: ws.dir,
      hasVersionReq: ws.hasVersionReq,
      inheritsFromWorkspace: true,
    });
  }
  return out;
}
