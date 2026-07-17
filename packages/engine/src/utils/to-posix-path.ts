/**
 * Normalize OS path separators to POSIX `/`.
 *
 * Windows' `path.join` emits back-slashed paths, so a caller that matches
 * on a trailing `/<name>` segment would otherwise need an OR-of-separators
 * at every comparison site — a branch that only one platform per CI run can
 * ever exercise. Normalizing once at the listing boundary collapses that
 * into a single, fully coverable path.
 */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}
