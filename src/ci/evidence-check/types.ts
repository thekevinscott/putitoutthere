/**
 * Shared types for the evidence-check gate (#445, epic #442).
 *
 * The gate's decision logic lives in this `src/ci/evidence-check/`
 * namespace as a set of small, I/O-free functions orchestrated by
 * `checkEvidence`. Every subprocess / file boundary the real gate
 * crosses — `gh api`, `sleep`, the clock, the changelog + diff text —
 * is injected via {@link CheckEvidenceDeps} so the orchestrator is
 * deterministic and unit-testable. The thin boundary that supplies the
 * real dependencies is `.github/workflows/evidence-check.mjs`.
 */

/** A GitHub Actions workflow run, as returned by `actions/runs`. */
export interface WorkflowRun {
  id: number;
  name?: string | null | undefined;
  display_title?: string | null | undefined;
  path?: string | null | undefined;
  event?: string | null | undefined;
  status?: string | null | undefined;
  conclusion?: string | null | undefined;
}

/** A job within a workflow run, as returned by `actions/runs/:id/jobs`. */
export interface Job {
  name?: string | null | undefined;
}

/** A single CHANGELOG bullet added by the PR, with its 1-based line. */
export interface Bullet {
  line: number;
  text: string;
}

/** A parsed trailing evidence clause on a bullet. */
export interface EvidenceClause {
  kind: string;
  value: string;
}

/** The subset of a `gh api` JSON response the gate reads. */
export interface GhApiResponse {
  workflow_runs?: WorkflowRun[] | undefined;
  jobs?: Job[] | undefined;
}

/** Fetches the jobs for a run id, memoized by the orchestrator. */
export type JobsForRun = (runId: number) => Job[];

/** Injected dependencies for {@link CheckEvidenceDeps}. */
export interface CheckEvidenceDeps {
  /** The full `CHANGELOG.md` text at HEAD. */
  changelog: string;
  /** `git diff --unified=0 BASE HEAD -- CHANGELOG.md` output. */
  diff: string;
  baseSha: string;
  headSha: string;
  /** `owner/repo`, used to build the `gh api` paths. */
  repository: string;
  /** Runs `gh api -X GET <path>` and returns the parsed JSON. */
  ghApi: (path: string) => GhApiResponse;
  /** Blocks for the given number of seconds (real gate: `sleep`). */
  sleepSeconds: (seconds: number) => void;
  /** Returns the current epoch millis (real gate: `Date.now`). */
  now: () => number;
  /** Emits a line (real gate: `console.log`). */
  log: (message: string) => void;
  /** Total polling budget; defaults to 20 minutes. */
  pollWindowMs?: number | undefined;
  /** Delay between polls; defaults to 30 seconds. */
  pollIntervalMs?: number | undefined;
}
