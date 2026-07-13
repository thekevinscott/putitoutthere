/**
 * Resolve a citation against the current runs, matching the bash
 * `citationResolution`:
 *   - `pending` — no matching run yet, or a match is still queued/in_progress.
 *   - `passed`  — at least one matching run completed successfully.
 *   - `failed`  — every matching run reached a terminal state and none passed.
 */
import type { WorkflowJob, WorkflowRun } from './evidence-check-types.js';
import { isSuccessfulRun } from './is-successful-run.js';
import { runMatches } from './run-matches.js';

export type CitationState = 'pending' | 'passed' | 'failed';

export function citationResolution(
  citation: string,
  runs: readonly WorkflowRun[],
  jobsForRun: (runId: number) => readonly WorkflowJob[],
): CitationState {
  const matches = runs.filter((run) => runMatches(run, citation, jobsForRun));
  if (matches.length === 0) {
    return 'pending';
  }
  const anyPassed = matches.some(isSuccessfulRun);
  if (anyPassed) {
    return 'passed';
  }
  const allCompleted = matches.every((run) => run.status === 'completed');
  if (allCompleted) {
    return 'failed';
  }
  return 'pending';
}
