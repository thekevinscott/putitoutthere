/**
 * Whether a citation has passing evidence, matching the bash `passedEvidence`:
 * some matching run both completed and concluded `success`. The final gate
 * decision consults this after the poll loop has let cited runs settle.
 */
import type { WorkflowJob, WorkflowRun } from './evidence-check-types.js';
import { isSuccessfulRun } from './is-successful-run.js';
import { runMatches } from './run-matches.js';

export function passedEvidence(
  citation: string,
  runs: readonly WorkflowRun[],
  jobsForRun: (runId: number) => readonly WorkflowJob[],
): boolean {
  return runs.filter(isSuccessfulRun).some((run) => runMatches(run, citation, jobsForRun));
}
