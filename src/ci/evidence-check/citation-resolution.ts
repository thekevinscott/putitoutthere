import { runMatches } from './run-matches.js';
import type { JobsForRun, WorkflowRun } from './types.js';

/**
 * Resolve a citation against the currently-known runs:
 *
 * - `'passed'`  — at least one matching run completed successfully.
 * - `'failed'`  — every matching run reached a terminal state and none
 *   succeeded.
 * - `'pending'` — no matching runs yet, or at least one match is still
 *   queued / in progress.
 */
export function citationResolution(
  citation: string,
  runs: WorkflowRun[],
  jobsForRun: JobsForRun,
): 'passed' | 'failed' | 'pending' {
  const matches = runs.filter((run) => runMatches(run, citation, jobsForRun));
  if (matches.length === 0) {
    return 'pending';
  }
  if (matches.some((run) => run.status === 'completed' && run.conclusion === 'success')) {
    return 'passed';
  }
  if (matches.every((run) => run.status === 'completed')) {
    return 'failed';
  }
  return 'pending';
}
