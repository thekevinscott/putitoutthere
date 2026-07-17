/**
 * Composition root for the evidence-check gate (#445). Reads BASE_SHA /
 * HEAD_SHA (and the ambient GITHUB_REPOSITORY) from the env, runs the real
 * I/O the decision needs — the `git diff` of CHANGELOG.md, the file read, the
 * `gh api` run/job queries (cached), the bounded poll (`sleep`, clock) — then
 * feeds the settled state to `decideEvidenceCheck`, writes the lines, and
 * returns the exit code. The only I/O lives here; every decision is a pure
 * module under this directory.
 */
import { readFile } from 'node:fs/promises';

import { execCapture } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';
import { sleep } from '../utils/sleep.js';
import { addedUnreleasedBullets } from './added-bullets.js';
import { citedRunNeedles } from './cited-needles.js';
import { decideEvidenceCheck } from './decide.js';
import type { WorkflowJob, WorkflowRun } from './evidence-check-types.js';
import { passedEvidence } from './passed-evidence.js';
import { pollUntilResolved } from './poll.js';

// Bounded wait for cited runs to settle, and the gap between polls. Passed to
// `pollUntilResolved` (which holds no magic constants) so run.test.ts pins
// their exact values via the recorded call.
const POLL_DEADLINE_MS = 20 * 60 * 1000;
const POLL_INTERVAL_SECONDS = 30;

export async function runEvidenceCheck(): Promise<number> {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA;
  if (base === undefined || base === '' || head === undefined || head === '') {
    process.stdout.write('::error::evidence-check: BASE_SHA and HEAD_SHA must be set.\n');
    return 1;
  }
  const repository = process.env.GITHUB_REPOSITORY;

  const { stdout: diff } = await execCapture('git', ['diff', '--unified=0', base, head, '--', 'CHANGELOG.md']);
  const patch = diff.split(/\r?\n/);
  const changelog = (await readFile('CHANGELOG.md', 'utf8')).split(/\r?\n/);
  const bullets = addedUnreleasedBullets(changelog, patch);

  // `gh` stderr was inherited to the terminal under execFileSync; execCapture
  // captures it, so surface it in the thrown message to keep diagnosability.
  const ghApi = async (path: string): Promise<unknown> => {
    let stdout: string;
    try {
      ({ stdout } = await execCapture('gh', ['api', '-X', 'GET', path]));
    } catch (err) {
      const stderr = err instanceof ExecError ? err.stderr : '';
      throw new Error(`gh api ${path} failed: ${stderr}`, { cause: err });
    }
    return JSON.parse(stdout);
  };

  const jobsByRun = new Map<number, WorkflowJob[]>();
  // Sync cache reader handed to the pure decision code (runMatches /
  // citationResolution / passedEvidence stay sync). The job I/O is prefetched
  // in `runsForHead` below, so this never triggers a subprocess.
  const jobsForRun = (runId: number): WorkflowJob[] => jobsByRun.get(runId) ?? [];

  let cachedRuns: WorkflowRun[] | null = null;
  const runsForHead = async (): Promise<WorkflowRun[]> => {
    if (cachedRuns !== null) {
      return cachedRuns;
    }
    const encodedSha = encodeURIComponent(head);
    const response = (await ghApi(`repos/${repository}/actions/runs?head_sha=${encodedSha}&per_page=100`)) as {
      workflow_runs?: WorkflowRun[];
    };
    cachedRuns = response.workflow_runs ?? [];
    // Prefetch each run's jobs so the sync `jobsForRun` reader is I/O-free.
    for (const run of cachedRuns) {
      if (!jobsByRun.has(run.id)) {
        const jobsResponse = (await ghApi(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`)) as {
          jobs?: WorkflowJob[];
        };
        jobsByRun.set(run.id, jobsResponse.jobs ?? []);
      }
    }
    return cachedRuns;
  };

  const resetRunCaches = (): void => {
    cachedRuns = null;
    jobsByRun.clear();
  };

  const needles = citedRunNeedles(bullets);
  await pollUntilResolved({
    needles,
    deadlineMs: POLL_DEADLINE_MS,
    now: () => Date.now(),
    sleep: () => sleep(POLL_INTERVAL_SECONDS * 1000),
    log: (message) => process.stdout.write(`${message}\n`),
    loadRuns: runsForHead,
    jobsForRun,
    resetCaches: resetRunCaches,
  });

  // Resolve run/job state for the sync `passedEvidence` predicate. Only the
  // cited buckets reach that predicate (decide gates on the same allowed
  // buckets `citedRunNeedles` collected), so with no needles there is no
  // citation to check — skip the query entirely, matching the pre-async gate,
  // which only ever hit `gh` when a citation needed resolving.
  let runs: readonly WorkflowRun[] = [];
  if (needles.size > 0) {
    runs = await runsForHead();
  }
  const result = decideEvidenceCheck({
    bullets,
    baseSha: base,
    headSha: head,
    passedEvidence: (citation) => passedEvidence(citation, runs, jobsForRun),
  });
  for (const line of result.lines) {
    process.stdout.write(`${line}\n`);
  }
  return result.exitCode;
}
