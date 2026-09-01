/**
 * Decision core for the willfire-callback adapter (#681): validates the
 * WILLFIRE_* env contract willfire hands to a callback command before any
 * fixture materialization happens. Pure — the workflow-file existence
 * check is a fact `run.ts` gathers via I/O and passes in, so every guard
 * and its exact failure wording is pinned here independent of how `run.ts`
 * reads the environment or the filesystem.
 */

import { parseWillfireInputs } from './parse-inputs.js';

export const EXPECTED_WORKFLOW = '.github/workflows/e2e-fixture-job.yml';
export const EXPECTED_WORKFLOW_REPO = 'thekevinscott/putitoutthere';
const SUPPORTED_JOB = 'plan';

export interface DecideWillfireCallbackInput {
  job: string | undefined;
  workflow: string | undefined;
  workflowRepo: string | undefined;
  workflowFileExists: boolean;
  inputsJson: string | undefined;
}

export type DecideWillfireCallbackResult = { ok: true; fixture: string } | { ok: false; reason: string };

export function decideWillfireCallback(input: DecideWillfireCallbackInput): DecideWillfireCallbackResult {
  const { job, workflow, workflowRepo, workflowFileExists, inputsJson } = input;

  if (job !== SUPPORTED_JOB) {
    return {
      ok: false,
      reason: `willfire-callback: unsupported WILLFIRE_JOB '${job ?? '<unset>'}' (only '${SUPPORTED_JOB}' is supported)`,
    };
  }

  if (workflow !== EXPECTED_WORKFLOW) {
    return {
      ok: false,
      reason: `willfire-callback: unexpected WILLFIRE_WORKFLOW '${workflow ?? '<unset>'}' (expected '${EXPECTED_WORKFLOW}')`,
    };
  }

  if (!workflowFileExists) {
    return {
      ok: false,
      reason: `willfire-callback: expected workflow file '${EXPECTED_WORKFLOW}' not found under the current checkout — layout mismatch`,
    };
  }

  if (workflowRepo !== EXPECTED_WORKFLOW_REPO) {
    return {
      ok: false,
      reason: `willfire-callback: unexpected WILLFIRE_WORKFLOW_REPO '${workflowRepo ?? '<unset>'}' (expected '${EXPECTED_WORKFLOW_REPO}')`,
    };
  }

  return parseWillfireInputs(inputsJson);
}
