import { addedUnreleasedBullets } from './added-unreleased-bullets.js';
import { ALLOWED_BUCKETS } from './allowed-buckets.js';
import { citationResolution } from './citation-resolution.js';
import { citedRunNeedles } from './cited-run-needles.js';
import { evaluateBullets } from './evaluate-bullets.js';
import { runMatches } from './run-matches.js';
import type { CheckEvidenceDeps, Job, WorkflowRun } from './types.js';

export type { CheckEvidenceDeps, WorkflowRun } from './types.js';

const DEFAULT_POLL_WINDOW_MS = 20 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 30 * 1000;

/**
 * Evidence-check gate orchestrator (#445, epic #442). Validates that
 * every CHANGELOG bullet added under `## Unreleased` cites machine-checked
 * evidence that actually passed on HEAD, reproducing the decision logic of
 * the former inline `evidence-check.yml`.
 *
 * All I/O is injected via {@link CheckEvidenceDeps} so this stays
 * deterministic and unit-testable; the real subprocess/file boundary lives
 * in `.github/workflows/evidence-check.mjs`. Returns a process exit code:
 * `0` on success, `1` when any added bullet fails validation.
 */
export function checkEvidence(deps: CheckEvidenceDeps): number {
  const { changelog, diff, baseSha, headSha, repository, ghApi, sleepSeconds, now, log } = deps;
  const pollWindowMs = deps.pollWindowMs ?? DEFAULT_POLL_WINDOW_MS;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const changelogLines = changelog.split(/\r?\n/);
  const patchLines = diff.split(/\r?\n/);

  let workflowRuns: WorkflowRun[] | null = null;
  const jobsByRun = new Map<number, Job[]>();

  function runsForHead(): WorkflowRun[] {
    if (workflowRuns) {
      return workflowRuns;
    }
    const encodedSha = encodeURIComponent(headSha);
    const response = ghApi(`repos/${repository}/actions/runs?head_sha=${encodedSha}&per_page=100`);
    workflowRuns = response.workflow_runs ?? [];
    return workflowRuns;
  }

  function resetRunCaches(): void {
    workflowRuns = null;
    jobsByRun.clear();
  }

  function jobsForRun(runId: number): Job[] {
    const cached = jobsByRun.get(runId);
    if (cached) {
      return cached;
    }
    const response = ghApi(`repos/${repository}/actions/runs/${runId}/jobs?per_page=100`);
    const jobs = response.jobs ?? [];
    jobsByRun.set(runId, jobs);
    return jobs;
  }

  function passedEvidence(citation: string): boolean {
    return runsForHead().some((run) => {
      if (run.status !== 'completed' || run.conclusion !== 'success') {
        return false;
      }
      return runMatches(run, citation, jobsForRun);
    });
  }

  const bullets = addedUnreleasedBullets(changelogLines, patchLines);

  // Race-aware wait: evidence-check fires on `pull_request:` in parallel
  // with every workflow whose evidence it cites. Cited runs may still be
  // queued / in_progress — or not yet indexed under `actions/runs` — when
  // we first query. Poll per-citation until each resolves or the polling
  // budget is spent, then run the success/fail decision.
  //
  // The loop is bounded by accumulated poll time (`pollIntervalMs` per
  // iteration, up to `pollWindowMs`) rather than a wall-clock deadline, so
  // it always terminates even under a frozen injected clock. `now()` still
  // drives the human-readable elapsed shown in each progress line.
  const startedAt = now();
  const needles = citedRunNeedles(bullets, ALLOWED_BUCKETS);
  if (needles.size > 0) {
    let waitedMs = 0;
    while (waitedMs < pollWindowMs) {
      const pending = [...needles].filter(
        (citation) => citationResolution(citation, runsForHead(), jobsForRun) === 'pending',
      );
      if (pending.length === 0) {
        break;
      }
      const elapsedSeconds = Math.round((now() - startedAt) / 1000);
      log(
        `evidence-check: t+${elapsedSeconds}s — ${pending.length} citation(s) ` +
          `still pending (no matching workflow_run yet, or matches still in_progress / queued): ` +
          `${pending.join(', ')}`,
      );
      sleepSeconds(pollIntervalMs / 1000);
      waitedMs += pollIntervalMs;
      resetRunCaches();
    }
  }

  const failures = evaluateBullets({ bullets, allowedBuckets: ALLOWED_BUCKETS, passedEvidence, headSha });
  if (failures.length > 0) {
    for (const failure of failures) {
      log(`::error::${failure}`);
    }
    return 1;
  }

  log(`Evidence check passed for CHANGELOG.md additions between ${baseSha} and ${headSha}.`);
  return 0;
}
