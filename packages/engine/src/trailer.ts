/**
 * Release trailer parser (#6; grammar plan.md §10.3, semantics §10.6):
 * `release: patch|minor|major|skip [ "[" name, name "]" ]`. The key match is
 * case-insensitive and only the LAST `release:` line wins. Pure TypeScript —
 * no `git interpret-trailers`, no folded-continuation support.
 */

import { parseTrailerPayload } from './parse-trailer-payload.js';
import type { Bump } from './types.js';

export interface Trailer {
  bump: Bump | 'skip';
  packages: string[];
}

export function parseTrailer(commitBody: string): Trailer | null {
  const lines = commitBody.split(/\r?\n/);
  // Scan in reverse; first hit = last occurrence.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    // Anchored with `^\s*` so indented trailers still count (§10 is silent on
    // indentation; real commit bodies rarely indent trailers, be lenient).
    const key = /^\s*release\s*:/i.exec(line);
    if (!key) {continue;}
    return parseTrailerPayload(line.slice(key[0].length));
  }
  return null;
}
