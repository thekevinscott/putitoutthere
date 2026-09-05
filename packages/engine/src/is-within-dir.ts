/**
 * Directory containment over repo-relative, forward-slashed paths — the form
 * `git status --porcelain` and `repoRelativePaths` both speak.
 *
 * Callers pass directories that came out of `repoRelativePaths`, which never
 * yields an empty string, so there is no "empty means the whole tree" case to
 * defend against here.
 */

/** Whether `path` names `dir` itself or anything inside it. */
export function isWithinDir(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}
