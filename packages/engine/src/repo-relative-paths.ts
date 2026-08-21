/**
 * Absolute paths rendered the way `git status --porcelain` renders them:
 * relative to the repository root, forward-slashed. #639.
 *
 * The crates pre-publish dirty-tree check compares engine-managed paths
 * against porcelain output, and porcelain names every file relative to the
 * repo root with forward slashes on every platform. Comparing an absolute,
 * platform-separated path against that never matches, so the conversion has
 * to happen first — and it happens for three different sets of paths (the
 * manifests `writeVersion` wrote, the sibling package directories, the
 * artifacts root), which is why it lives here rather than inline three times.
 *
 * Paths that do not sit under `cwd` are dropped rather than returned in
 * `../…` form: porcelain can never name a file outside the repository, so
 * such an entry could only ever fail to match, and keeping it would suggest
 * to a reader that it might match something.
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
