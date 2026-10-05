/**
 * Mode dispatcher for the e2e PyPI tag harness (#718). Routes
 * `e2e-fixture.yml`'s `pypi-tag` steps — `prepare` (derive what the upload
 * shipped, build the throwaway tree) and `assert` (read the tags back) — to
 * their composition roots, and rejects an unknown/missing mode.
 */

import { runPypiTagAssert } from './run-assert.js';
import { runPypiTagPrepare } from './run-prepare.js';

export async function runPypiTagVerify(argv: readonly string[]): Promise<number> {
  const mode = argv[3];
  if (mode === 'prepare') {
    return runPypiTagPrepare();
  }
  if (mode === 'assert') {
    return runPypiTagAssert();
  }
  process.stdout.write(
    `::error::pypi-tag-verify: mode must be one of prepare|assert (got ${mode ?? '<none>'}).\n`,
  );
  return 1;
}
