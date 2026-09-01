/**
 * Checks whether the fixture-matrix callee workflow actually exists under
 * the current checkout — the fail-closed layout guard added on top of
 * WILLFIRE_WORKFLOW's string match (#681). `.github/workflows/
 * e2e-fixture-job.yml` is a release-path filename AGENTS.md forbids
 * renaming (Trusted Publisher records encode it), so hardcoding the
 * expected path here is safe.
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { EXPECTED_WORKFLOW } from './decide.js';

export async function workflowFileExists(cwd: string): Promise<boolean> {
  try {
    await access(join(cwd, EXPECTED_WORKFLOW));
    return true;
  } catch {
    return false;
  }
}
