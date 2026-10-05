/**
 * Absolute paths rendered the way `git status --porcelain` renders them:
 * relative to the repo root, forward-slashed on every platform (#639). Paths
 * outside `cwd` are dropped rather than returned in `../…` form — porcelain
 * can never name a file outside the repo, so they could only fail to match.
 */

import { relative } from 'node:path';

/** Windows separators to the forward slashes git and this repo speak in. */
export function toPosixPath(p: string): string {
  return p.replaceAll('\\', '/');
}

/**
 * `paths` as repo-relative, forward-slashed strings, dropping any that
 * resolve to `cwd` itself or to somewhere outside it. `undefined` means "no
 * paths" and yields an empty list, so callers holding an optional field can
 * pass it straight through.
 */
export function repoRelativePaths(
  cwd: string,
  paths: readonly string[] | undefined,
): string[] {
  const out: string[] = [];
  for (const p of paths ?? []) {
    const rel = relative(cwd, p);
    if (rel === '' || rel.startsWith('..')) {continue;}
    out.push(toPosixPath(rel));
  }
  return out;
}
