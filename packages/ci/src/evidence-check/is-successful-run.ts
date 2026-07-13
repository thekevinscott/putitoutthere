/**
 * Whether a workflow run completed successfully — the `status === 'completed'
 * && conclusion === 'success'` predicate the bash used for both citation
 * resolution and evidence passing. Written as two single-comparison guards
 * rather than one compound `&&` so each condition is independently
 * mutation-killable.
 */
import type { WorkflowRun } from './evidence-check-types.js';

export function isSuccessfulRun(run: WorkflowRun): boolean {
  if (run.status !== 'completed') {
    return false;
  }
  return run.conclusion === 'success';
}
