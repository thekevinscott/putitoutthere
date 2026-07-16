/**
 * Glob matcher. Thin wrapper over minimatch with the flags putitoutthere
 * needs everywhere.
 *
 * Flags per plan.md §11.4:
 *   - dot: true       — real repos keep config under .github/, .config/, etc.
 *   - matchBase: false — patterns anchor at the repo root
 *
 * Double-star crosses directory boundaries; brace expansion is on.
 *
 * Issue #10.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { pathExists } from './utils/path-exists.js';

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

const GLOB_META = /[*?[\]{}]/;

/**
 * Expand a relative path glob against the filesystem, returning the
 * directories it matches. Mirrors how cargo resolves `[workspace].members`
 * entries: a literal entry (no glob metacharacter) resolves to a single
 * path returned whether or not it exists — callers handle a missing
 * directory — while a glob entry is matched one path segment at a time
 * against the real directory tree, so only existing directories come back.
 */
export async function expandDirGlob(baseDir: string, pattern: string): Promise<string[]> {
  const segments = pattern.split('/').filter((s) => s.length > 0);
  let dirs = [baseDir];
  for (const segment of segments) {
    if (!GLOB_META.test(segment)) {
      dirs = dirs.map((d) => join(d, segment));
      continue;
    }
    // Sequential expansion (no Promise.all): matches the prior flatMap
    // order — readdir order within each dir, dirs in their existing order.
    const next: string[] = [];
    for (const d of dirs) {
      if (!(await pathExists(d))) {continue;}
      for (const e of await readdir(d, { withFileTypes: true })) {
        if (e.isDirectory() && matchesGlob(segment, e.name)) {
          next.push(join(d, e.name));
        }
      }
    }
    dirs = next;
  }
  return dirs;
}
