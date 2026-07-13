/**
 * Whether a workflow run satisfies a citation, matching the bash `runMatches`:
 * the normalised citation is a substring of any normalised run field
 * (`name`, `display_title`, `path`, `event`), or of any normalised job name.
 * Jobs are fetched lazily via the injected `jobsForRun` only when no run field
 * matched, preserving the bash's short-circuit.
 */
import type { WorkflowJob, WorkflowRun } from './evidence-check-types.js';
import { normalize } from './normalize.js';

export function runMatches(
  run: WorkflowRun,
  citation: string,
  jobsForRun: (runId: number) => readonly WorkflowJob[],
): boolean {
  const wanted = normalize(citation);
  const runFields = [run.name, run.display_title, run.path, run.event].map(normalize);
  if (runFields.some((field) => field.includes(wanted))) {
    return true;
  }
  return jobsForRun(run.id).some((job) => normalize(job.name).includes(wanted));
}
