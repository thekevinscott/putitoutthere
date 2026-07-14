/**
 * Shared shapes for the patch-coverage gate (#468). No runtime code — just the
 * types the decision cores and the composition root pass between them.
 */

/** One added post-image line: its absolute line number and its text. */
export interface AddedLine {
  line: number;
  text: string;
}

/** The added lines recorded for one counted post-image file. */
export interface AddedFile {
  file: string;
  added: AddedLine[];
}

/** The line numbers a file's coverage record marks covered / uncovered. */
export interface CoveredLines {
  covered: Set<number>;
  uncovered: Set<number>;
}

/**
 * The subset of one file's istanbul-format coverage record the gate reads:
 * per-statement hit counts (`s`) and the statement location map.
 */
export interface FileCoverage {
  s: Record<string, number>;
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
}

/** A recorded gate violation: an uncovered added line or an escape-hatch marker. */
export interface Violation {
  file: string;
  line: number;
  kind: 'escape-hatch' | 'uncovered';
  msg: string;
}

/** Input to the pure decision: the added lines and a coverage lookup for a file. */
export interface PatchCoverageInput {
  addedByFile: readonly AddedFile[];
  coverageFor: (file: string) => CoveredLines | null;
}

/** The decision's outcome: exit code plus the stdout / stderr lines to emit. */
export interface PatchCoverageResult {
  exitCode: number;
  out: readonly string[];
  err: readonly string[];
}
