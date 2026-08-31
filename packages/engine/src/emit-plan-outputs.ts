/**
 * Write a plan run's workflow-facing facts to `$GITHUB_OUTPUT` (#146, #622).
 *
 * Two keys, one append:
 *
 *  - `matrix` — the build matrix `_matrix.yml`'s `build` job fans out over.
 *  - `unpublished_kinds` — the registry kinds this run still has something to
 *    publish (#622). `release.yml` gates its crates.io OIDC exchange on this
 *    so a re-run whose crates versions are all live no longer demands a
 *    working trusted publisher for work it will skip.
 *
 * Both are skipped entirely when the matrix is empty (#146): the consumer
 * workflow's `if: fromJSON(...)[0] != null` guard only fires when the output
 * key exists, and emitting `matrix=[]` races against the "output not set"
 * branch the workflow expects. The publish job is skipped in that case, so
 * there is no auth gate left to answer either.
 *
 * A no-op when `$GITHUB_OUTPUT` is unset (local runs), so callers don't have
 * to branch on being inside Actions.
 */

import { appendFile } from 'node:fs/promises';

import type { MatrixRow } from './plan.js';
import type { PlanVerdict } from './plan-status-types.js';
import { unpublishedKinds } from './unpublished-kinds.js';

export async function emitPlanOutputs(
  matrix: readonly MatrixRow[],
  verdicts: readonly PlanVerdict[],
  githubOutput: string | undefined,
): Promise<void> {
  if (githubOutput === undefined || githubOutput === '') {return;}
  if (matrix.length === 0) {return;}
  await appendFile(
    githubOutput,
    `matrix=${JSON.stringify(matrix)}\n` +
      `unpublished_kinds=${JSON.stringify(unpublishedKinds(verdicts))}\n`,
    'utf8',
  );
}
