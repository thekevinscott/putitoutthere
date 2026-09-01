/**
 * Composition root for the willfire-callback adapter (#681): gathers the
 * WILLFIRE_* env and the checkout-layout fact `decide.ts` needs, delegates
 * matrix computation to the fixture-matrix gate (#670), and re-encodes its
 * output as the flat, all-string envelope willfire's callback-command
 * protocol requires. Design-commitments non-goal #7: a thin reader over
 * the fixture-matrix gate's own function, never a parallel
 * reimplementation of matrix logic.
 */

import { buildWillfireCallbackOutput } from './build-output.js';
import { captureFixtureMatrix } from './capture-fixture-matrix.js';
import { decideWillfireCallback } from './decide.js';
import { workflowFileExists } from './workflow-file-exists.js';

interface FixtureMatrixSuccessDocument {
  fixture: string;
  matrix: unknown[];
  has_pypi: boolean;
}

export async function runWillfireCallback(): Promise<number> {
  const decision = decideWillfireCallback({
    job: process.env.WILLFIRE_JOB,
    workflow: process.env.WILLFIRE_WORKFLOW,
    workflowRepo: process.env.WILLFIRE_WORKFLOW_REPO,
    workflowFileExists: await workflowFileExists(process.cwd()),
    inputsJson: process.env.WILLFIRE_INPUTS,
  });
  if (!decision.ok) {
    process.stderr.write(`${decision.reason}\n`);
    return 1;
  }

  const captured = await captureFixtureMatrix(decision.fixture);
  if (captured.exitCode !== 0) {
    process.stderr.write(`willfire-callback: ${captured.stderr.trim()}\n`);
    return captured.exitCode;
  }

  const doc = JSON.parse(captured.stdout) as FixtureMatrixSuccessDocument;
  const output = buildWillfireCallbackOutput(doc.matrix, doc.has_pypi);
  process.stdout.write(`${JSON.stringify(output)}\n`);
  return 0;
}
