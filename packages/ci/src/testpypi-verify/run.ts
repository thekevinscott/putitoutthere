/**
 * Mode dispatcher for the TestPyPI verify/assert harness (#455, epic #442).
 * Routes the two steps of `e2e-fixture.yml`'s `testpypi-publish` job —
 * `assert` (the pre-publish artifact guard) and `metadata` (the post-publish
 * download + version verification) — to their composition roots, and rejects
 * an unknown/missing mode. Both are invoked as
 * `pnpm exec piot-ci testpypi-verify <mode>`.
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
