/**
 * Turns one file's istanbul-format coverage record into covered / uncovered
 * line sets, for the patch-coverage gate (#468). Reproduces the `.mjs`'s
 * `coveredLines`: a statement spans start.line..end.line inclusive, and a line
 * touched by both a covered and an uncovered statement is covered. Pure.
 */

import type { CoveredLines, FileCoverage } from './patch-coverage-types.js';

export function coveredLines(data: FileCoverage | undefined): CoveredLines | null {
  if (data === undefined) {
    return null;
  }
  const covered = new Set<number>();
  const uncovered = new Set<number>();
  for (const [id, hits] of Object.entries(data.s)) {
    const loc = data.statementMap[id];
    if (loc === undefined) {
      continue;
    }
    for (let l = loc.start.line; l <= loc.end.line; l++) {
      if (hits > 0) {
        covered.add(l);
      } else {
        uncovered.add(l);
      }
    }
  }
  for (const l of covered) {
    uncovered.delete(l);
  }
  return { covered, uncovered };
}
