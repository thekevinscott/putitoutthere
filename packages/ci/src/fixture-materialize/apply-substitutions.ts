/**
 * Apply ordered literal (non-regex) substitutions to a string. Mirrors the
 * fixture-materialize bash's `sed`/`perl` passes, whose patterns are fixed
 * strings (`__VERSION__`, `-placeholder`) with no regex metacharacters — so a
 * global literal replace is exactly equivalent.
 */

import type { Substitution } from './decide.js';

export function applySubstitutions(content: string, substitutions: readonly Substitution[]): string {
  let result = content;
  for (const { from, to } of substitutions) {
    result = result.split(from).join(to);
  }
  return result;
}
