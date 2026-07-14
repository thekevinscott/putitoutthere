/**
 * Whether a trimmed added line carries no v8-instrumented statement, so the
 * patch-coverage gate (#468) skips it rather than demand coverage. Reproduces
 * the `.mjs`'s skip chain: blank line, `//` line comment, `/*` block-comment
 * open, `*` block-comment continuation (which also covers the block-comment
 * closer the `.mjs` listed separately), and pure punctuation. Pure.
 */

import { isPurePunctuation } from './is-pure-punctuation.js';

export function isNonStatementLine(trimmed: string): boolean {
  if (trimmed.length === 0) {
    return true;
  }
  if (trimmed.startsWith('//')) {
    return true;
  }
  if (trimmed.startsWith('/*')) {
    return true;
  }
  if (trimmed.startsWith('*')) {
    return true;
  }
  return isPurePunctuation(trimmed);
}
