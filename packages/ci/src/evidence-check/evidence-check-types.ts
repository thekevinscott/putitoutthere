/**
 * Shared types for the evidence-check gate (#445), which enforces AGENTS.md's
 * "Verification policy": every newly-added `## Unreleased` CHANGELOG.md bullet
 * carries a `(verified by: <bucket>/<name>)` or `(no fixture: <reason>)`
 * clause, and each cited bucket has a passing run/job on the PR HEAD.
 */

/** A newly-added bullet under `## Unreleased`, with its 1-based new-file line. */
export interface Bullet {
  line: number;
  text: string;
}

/** The parsed trailing evidence clause of a bullet. */
export interface EvidenceClause {
  kind: 'verified' | 'no-fixture';
  value: string;
}

/** A GitHub Actions `workflow_run` (only the fields the gate reads). */
export interface WorkflowRun {
  id: number;
  name?: string | null;
  display_title?: string | null;
  path?: string | null;
  event?: string | null;
  status?: string | null;
  conclusion?: string | null;
}

/** A GitHub Actions job within a run (only the fields the gate reads). */
export interface WorkflowJob {
  name?: string | null;
}

/** The gate's decision: process exit code and the lines to emit. */
export interface EvidenceCheckResult {
  exitCode: number;
  lines: readonly string[];
}
