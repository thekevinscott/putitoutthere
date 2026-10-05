/**
 * Mode dispatcher for the TestPyPI verify/assert harness (#455, epic #442).
 * Routes `e2e-fixture.yml`'s `testpypi-publish` steps — `assert` (the
 * pre-publish artifact guard) and `metadata` (post-publish download + version
 * verify) — to their composition roots, and rejects an unknown/missing mode.
 */

import { runTestpypiAssert } from './run-assert.js';
import { runTestpypiMetadata } from './run-metadata.js';

export async function runTestpypiVerify(argv: readonly string[]): Promise<number> {
  const mode = argv[3];
  if (mode === 'assert') {
    return runTestpypiAssert();
  }
  if (mode === 'metadata') {
    return runTestpypiMetadata();
  }
  process.stdout.write(
    `::error::testpypi-verify: mode must be one of assert|metadata (got ${mode ?? '<none>'}).\n`,
  );
  return 1;
}
