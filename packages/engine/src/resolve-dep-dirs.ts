/**
 * Resolve a manifest's dependency entries to the on-disk directories they
 * point at. #621.
 *
 * Two indirections have to be followed before a `path` is in hand, and
 * missing either one silently drops a crate from the version rewrite:
 *
 *  - a member may defer to the workspace (`demo-core.workspace = true`),
 *    which puts both the `path` and the version requirement in the
 *    workspace root's `[workspace.dependencies]`, a different file;
 *  - `path` is relative to the *declaring manifest's* directory, and for
 *    an inherited entry that is the workspace root, not the member.
 *
 * Shared by the discovery walk and the requirement rewrite so the two can
 * never disagree about which crates are in scope.
 */

import { isAbsolute, resolve } from 'node:path';

import { cargoDepEntries } from './cargo-dep-entries.js';

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
  const inherited = workspaceDepPaths(workspaceParsed);
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
    if (!entry.inheritsFromWorkspace || workspaceRoot === null) {continue;}
    const ws = inherited.get(entry.key);
    if (ws === undefined) {continue;}
    out.push({
      key: entry.key,
      // Relative to the workspace root, which declared it.
      dir: absolute(ws.path, workspaceRoot),
      hasVersionReq: ws.hasVersionReq,
      inheritsFromWorkspace: true,
    });
  }
  return out;
}

/** `[workspace.dependencies]` entries that carry a `path`, keyed by name. */
function workspaceDepPaths(
  workspaceParsed: unknown,
): Map<string, { path: string; hasVersionReq: boolean }> {
  const map = new Map<string, { path: string; hasVersionReq: boolean }>();
  if (workspaceParsed === null || typeof workspaceParsed !== 'object') {return map;}
  const workspace = (workspaceParsed as { workspace?: unknown }).workspace;
  if (workspace === null || typeof workspace !== 'object') {return map;}
  const deps = (workspace as { dependencies?: unknown }).dependencies;
  if (deps === null || typeof deps !== 'object') {return map;}

  for (const [key, value] of Object.entries(deps as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') {continue;}
    const obj = value as Record<string, unknown>;
    if (typeof obj['path'] !== 'string') {continue;}
    map.set(key, {
      path: obj['path'],
      hasVersionReq: typeof obj['version'] === 'string',
    });
  }
  return map;
}

function absolute(p: string, base: string): string {
  return isAbsolute(p) ? p : resolve(base, p);
}
