/**
 * Reads every top-level job's declared `name:` out of a GitHub Actions
 * workflow (#655).
 *
 * `null` means the job declared none, and GitHub then derives the check name
 * itself. For a matrix job that derivation renders *every* field of the row:
 * `e2e-fixture-job.yml`'s matrix is `plan`'s output, whose rows carry a
 * `0.0.<unix_seconds>` version and — on `*-first-publish` fixtures — a
 * package name uniquified with `github.run_id` / `github.run_attempt`. Both
 * stamps are load-bearing (registry publishes are immutable, so every run
 * claims a fresh version slot and package name), so the check name of an
 * unnamed matrix job changes on every run: unreadable in the PR view,
 * unpredictable to willfire, and impossible to reference in a ruleset.
 */

import { parse } from 'yaml';

export function parseJobNameTemplates(workflowYaml: string): Map<string, string | null> {
  const doc: unknown = parse(workflowYaml);
  const jobs = (doc as { jobs?: unknown } | null)?.jobs;
  if (typeof jobs !== 'object' || jobs === null || Array.isArray(jobs)) {
    throw new Error('parseJobNameTemplates: workflow declares no `jobs:` mapping');
  }
  const templates = new Map<string, string | null>();
  for (const [id, job] of Object.entries(jobs as Record<string, unknown>)) {
    const declared = (job as { name?: unknown } | null)?.name;
    templates.set(id, typeof declared === 'string' ? declared : null);
  }
  return templates;
}
