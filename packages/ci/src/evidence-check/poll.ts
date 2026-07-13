/**
 * Race-aware wait, matching the bash poll loop. evidence-check fires on
 * `pull_request:` in parallel with every workflow whose evidence it cites, so
 * on a fresh push the cited runs are still queued/in_progress (or not yet
 * indexed) when first queried. Poll per-citation resolution until every
 * citation is settled (`passed`/`failed`) or the bounded deadline elapses,
 * reloading run/job state each iteration, and only then let the caller decide.
 *
 * All time and I/O are injected (`now`, `sleep`, `log`, `loadRuns`,
 * `jobsForRun`, `resetCaches`), and the deadline magnitude is passed in, so
 * this orchestration is fully unit-testable and carries no magic constants.
 */
import { citationResolution } from './citation-resolution.js';
import type { WorkflowJob, WorkflowRun } from './evidence-check-types.js';
import { pollPendingMessage } from './poll-message.js';

export interface PollDeps {
  needles: ReadonlySet<string>;
  deadlineMs: number;
  now: () => number;
  sleep: () => void;
  log: (message: string) => void;
  loadRuns: () => readonly WorkflowRun[];
  jobsForRun: (runId: number) => readonly WorkflowJob[];
  resetCaches: () => void;
}

export function pollUntilResolved(deps: PollDeps): void {
  if (deps.needles.size === 0) {
    return;
  }
  const start = deps.now();
  const deadline = start + deps.deadlineMs;
  while (deps.now() < deadline) {
    const runs = deps.loadRuns();
    const pending = [...deps.needles].filter(
      (citation) => citationResolution(citation, runs, deps.jobsForRun) === 'pending',
    );
    if (pending.length === 0) {
      return;
    }
    const elapsedSeconds = Math.round((deps.now() - start) / 1000);
    deps.log(pollPendingMessage(elapsedSeconds, pending));
    deps.sleep();
    deps.resetCaches();
  }
}
