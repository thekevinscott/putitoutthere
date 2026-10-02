/**
 * Normalize OS path separators to POSIX `/`. Windows' `path.join` emits
 * back-slashed paths, so callers matching a trailing `/<name>` segment would
 * otherwise need an OR-of-separators at every site — a branch only one platform
 * per CI run can exercise. Normalizing once at the boundary collapses that.
 */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}
