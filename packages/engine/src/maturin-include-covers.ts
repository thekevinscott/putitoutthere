import { extractIncludePath } from './extract-include-path.js';

export function maturinIncludeCovers(includes: readonly unknown[], stageTo: string): boolean {
  for (const entry of includes) {
    const path = extractIncludePath(entry);
    if (path === undefined) {continue;}
    // Strip trailing glob segments so `a/bin/*` and `a/bin/**` both
    // cover `a/bin`.
    const normalized = path.replace(/\/?\*+$/, '').replace(/\/$/, '');
    if (normalized === stageTo) {return true;}
    if (normalized.length > 0 && stageTo.startsWith(normalized + '/')) {return true;}
    if (path.startsWith(stageTo + '/') || path === stageTo) {return true;}
  }
  return false;
}
