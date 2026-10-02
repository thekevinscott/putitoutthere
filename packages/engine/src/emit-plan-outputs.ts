/**
 * Write a plan run's workflow-facing facts to `$GITHUB_OUTPUT` (#146, #622):
 * `matrix`, plus `unpublished_kinds` so `release.yml` skips its crates.io OIDC
 * exchange when nothing is left to publish. Both keys are omitted entirely on
 * an empty matrix: emitting `matrix=[]` races the "output not set" branch.
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
