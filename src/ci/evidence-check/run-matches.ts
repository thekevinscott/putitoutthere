import { normalize } from './normalize.js';
import type { JobsForRun, WorkflowRun } from './types.js';

/**
 * Does a workflow run satisfy a citation? A run matches when any of its
 * normalized identity fields (name / display_title / path / event) is a
 * fuzzy match for the normalized citation, falling back to the run's job
 * names. Fuzzy match is a bidirectional substring test on non-empty
 * fields: it holds whether the field contains the whole citation (a real
 * job like `e2e (js-vanilla) / publish` matching `e2e/js-vanilla`) or the
 * citation contains the field (a bucket-prefixed citation like
 * `e2e/js-vanilla-firstpub` matching a fixture-named run `js-vanilla-firstpub`).
 * Empty fields never match, so absent metadata can't spuriously satisfy a
 * citation.
 */
export function runMatches(run: WorkflowRun, citation: string, jobsForRun: JobsForRun): boolean {
  const wanted = normalize(citation);
  const matches = (field: string): boolean =>
    field !== '' && (field.includes(wanted) || wanted.includes(field));

  const runFields = [run.name, run.display_title, run.path, run.event].map(normalize);
  if (runFields.some(matches)) {
    return true;
  }

  return jobsForRun(run.id).some((job) => matches(normalize(job.name)));
}
