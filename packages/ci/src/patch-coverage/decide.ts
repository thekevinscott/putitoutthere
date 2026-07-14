/**
 * Decision core for the patch-coverage gate (#468). I/O-free: given the added
 * `src/**` lines and a coverage lookup (`coverageFor`, which the composition
 * root binds to the real coverage JSON), decide pass/fail, the exact
 * stdout (`out`) / stderr (`err`) lines, and the exit code. Extracted from
 * `.github/workflows/patch-coverage.mjs`; the decisions, `::error::` text, and
 * exit codes match it exactly (pinned in `decide.test.ts`).
 *
 * Two fatal violation kinds, both exit 1: an added line with no statement hit
 * (uncovered new code), or an added line introducing a `v8 ignore`
 * block-comment escape hatch. No additions, or every added line covered with
 * no hatches, passes (exit 0).
 */

import { isEscapeHatch } from './is-escape-hatch.js';
import { isNonStatementLine } from './is-non-statement-line.js';
import type { PatchCoverageInput, PatchCoverageResult, Violation } from './patch-coverage-types.js';

const PASS_NO_ADDITIONS = 'patch-coverage: no src/**/*.ts additions in this PR; passing.';
const PASS_CLEAN = 'patch-coverage: every added src/ line is covered, no escape hatches. ✓';

export function decidePatchCoverage(input: PatchCoverageInput): PatchCoverageResult {
  const { addedByFile, coverageFor } = input;

  if (addedByFile.length === 0) {
    return { exitCode: 0, out: [PASS_NO_ADDITIONS], err: [] };
  }

  const violations: Violation[] = [];
  for (const { file, added } of addedByFile) {
    const cl = coverageFor(file);
    for (const { line, text } of added) {
      if (isEscapeHatch(text)) {
        violations.push({ file, line, kind: 'escape-hatch', msg: `new ignore marker introduced: ${text.trim()}` });
        continue;
      }
      const trimmed = text.trim();
      if (isNonStatementLine(trimmed)) {
        continue;
      }
      if (cl === null) {
        violations.push({ file, line, kind: 'uncovered', msg: 'file has no coverage data (no test ever loaded it)' });
        continue;
      }
      if (!cl.covered.has(line) && cl.uncovered.has(line)) {
        violations.push({ file, line, kind: 'uncovered', msg: `added line not exercised by unit tests: ${trimmed}` });
      }
    }
  }

  if (violations.length === 0) {
    return { exitCode: 0, out: [PASS_CLEAN], err: [] };
  }

  const err: string[] = [
    'patch-coverage: violations found.',
    '',
    'Strict 100% on new src/ code; no `/* v8 ignore */` escape hatches.',
    'Add a unit test that exercises each new line listed below, or restructure',
    'the new code so it sits on an already-tested path.',
    '',
  ];
  for (const v of violations) {
    err.push(`::error file=${v.file},line=${v.line}::patch-coverage [${v.kind}] ${v.msg}`);
  }
  err.push('');
  err.push(`${violations.length} violation(s).`);
  return { exitCode: 1, out: [], err };
}
