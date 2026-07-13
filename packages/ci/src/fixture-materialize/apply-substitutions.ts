/**
 * Apply an ordered list of literal (non-regex) substitutions to a string,
 * replacing every occurrence of each `from` with its `to`. Mirrors the
 * fixture-materialize bash's `sed -i "s/__VERSION__/.../g"` /
 * `perl -i -pe "s/__VERSION__/.../g"` passes, whose patterns are fixed
 * strings (`__VERSION__`, `-placeholder`) with no regex metacharacters — so a
 * global literal replace is exactly equivalent. Pure; unit-tested directly.
 */

import type { Substitution } from './decide.js';

export function applySubstitutions(content: string, substitutions: readonly Substitution[]): string {
  let result = content;
  for (const { from, to } of substitutions) {
    result = result.split(from).join(to);
  }
  return result;
}
