/**
 * Composition root for the evidence-check gate (#445). Reads BASE_SHA /
 * HEAD_SHA (and the ambient GITHUB_REPOSITORY) from the env, runs the real
 * I/O the decision needs — the `git diff` of CHANGELOG.md, the file read, the
 * `gh api` run/job queries (cached), the bounded poll (`sleep`, clock) — then
 * feeds the settled state to `decideEvidenceCheck`, writes the lines, and
 * returns the exit code. The only I/O lives here; every decision is a pure
 * module under this directory.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

export function runEvidenceCheck(): number {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA;
  if (base === undefined || base === '' || head === undefined || head === '') {
    process.stdout.write('::error::evidence-check: BASE_SHA and HEAD_SHA must be set.\n');
    return 1;
  }
  const repository = process.env.GITHUB_REPOSITORY;

  const diff = execFileSync('git', ['diff', '--unified=0', base, head, '--', 'CHANGELOG.md'], { encoding: 'utf8' });
  const patch = diff.split(/\r?\n/);
  const changelog = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
  const bullets = addedUnreleasedBullets(changelog, patch);

  const ghApi = (path: string): unknown =>
    JSON.parse(
      execFileSync('gh', ['api', '-X', 'GET', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }),
    );

  let cachedRuns: WorkflowRun[] | null = null;
  const runsForHead = (): WorkflowRun[] => {
    if (cachedRuns !== null) {
      return cachedRuns;
    }
    const encodedSha = encodeURIComponent(head);
    const response = ghApi(`repos/${repository}/actions/runs?head_sha=${encodedSha}&per_page=100`) as {
      workflow_runs?: WorkflowRun[];
    };
    cachedRuns = response.workflow_runs ?? [];
    return cachedRuns;
  };

  const jobsByRun = new Map<number, WorkflowJob[]>();
  const jobsForRun = (runId: number): WorkflowJob[] => {
    const cached = jobsByRun.get(runId);
    if (cached !== undefined) {
      return cached;
    }
    const response = ghApi(`repos/${repository}/actions/runs/${runId}/jobs?per_page=100`) as { jobs?: WorkflowJob[] };
    const jobs = response.jobs ?? [];
    jobsByRun.set(runId, jobs);
    return jobs;
  };

  const resetRunCaches = (): void => {
    cachedRuns = null;
    jobsByRun.clear();
  };

  const sleep = (): void => {
    execFileSync('sleep', [String(POLL_INTERVAL_SECONDS)], { stdio: 'ignore' });
  };

  pollUntilResolved({
    needles: citedRunNeedles(bullets),
    deadlineMs: POLL_DEADLINE_MS,
    now: () => Date.now(),
    sleep,
    log: (message) => process.stdout.write(`${message}\n`),
    loadRuns: runsForHead,
    jobsForRun,
    resetCaches: resetRunCaches,
  });

  const result = decideEvidenceCheck({
    bullets,
    baseSha: base,
    headSha: head,
    passedEvidence: (citation) => passedEvidence(citation, runsForHead(), jobsForRun),
  });
  for (const line of result.lines) {
    process.stdout.write(`${line}\n`);
  }
  return result.exitCode;
}
