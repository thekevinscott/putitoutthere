/**
 * Glob matcher. Thin wrapper over minimatch with the flags putitoutthere needs
 * everywhere (plan.md §11.4, #10): `dot: true` because real repos keep config
 * under `.github/`, and `matchBase: false` so patterns anchor at the repo root.
 */

import { minimatch } from 'minimatch';

const OPTS = {
  dot: true,
  matchBase: false,
  nocomment: true, // putitoutthere.toml patterns aren't shell comments
} as const;

export function matchesGlob(pattern: string, path: string): boolean {
  return minimatch(path, pattern, OPTS);
}

export function matchesAny(patterns: readonly string[], path: string): boolean {
  for (const p of patterns) {
    if (matchesGlob(p, path)) {return true;}
  }
  return false;
}
