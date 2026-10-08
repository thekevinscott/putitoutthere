/**
 * `piot-ci` — dispatcher for putitoutthere's repo-internal CI gates. Gates are
 * tested TypeScript under `packages/ci/src/<gate>/`, invoked through this bin —
 * never as authored code in `.github/`, never by a `dist/` path. See AGENTS.md
 * > "Repo-internal CI gates". Returns the process exit code.
 */

import { runActionlintIdToken } from './actionlint-idtoken/run.js';
import { runCargoRegistry } from './cargo-registry/run.js';
import { runChangelogCheck } from './changelog-check/run.js';
import { runDiscardFirstPublishDists } from './discard-first-publish-dists/run.js';
import { runEvidenceCheck } from './evidence-check/run.js';
import { runFixtureMaterialize } from './fixture-materialize/run.js';
import { runFixtureMatrix } from './fixture-matrix/run.js';
import { runPatchCoverage } from './patch-coverage/run.js';
import { runPypiTagVerify } from './pypi-tag-verify/run.js';
import { runTddLint } from './tdd-lint/run.js';
import { runTestpypiVerify } from './testpypi-verify/run.js';
import { runVerdaccioAuth } from './verdaccio-auth/run.js';
import { printUsage } from './usage.js';

export async function run(argv: readonly string[]): Promise<number> {
  const cmd = argv[2];
  if (cmd === undefined) {
    printUsage();
    return 1;
  }
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printUsage();
    return 0;
  }
  if (cmd === 'changelog-check') {
    return runChangelogCheck();
  }
  if (cmd === 'tdd-lint') {
    return runTddLint();
  }
  if (cmd === 'actionlint-idtoken') {
    return runActionlintIdToken();
  }
  if (cmd === 'evidence-check') {
    return runEvidenceCheck();
  }
  if (cmd === 'patch-coverage') {
    return runPatchCoverage();
  }
  if (cmd === 'fixture-materialize') {
    return runFixtureMaterialize(argv);
  }
  if (cmd === 'fixture-matrix') {
    return runFixtureMatrix(argv);
  }
  if (cmd === 'verdaccio-auth') {
    return runVerdaccioAuth();
  }
  if (cmd === 'cargo-registry') {
    return runCargoRegistry(argv);
  }
  if (cmd === 'testpypi-verify') {
    return runTestpypiVerify(argv);
  }
  if (cmd === 'pypi-tag-verify') {
    return runPypiTagVerify(argv);
  }
  if (cmd === 'discard-first-publish-dists') {
    return runDiscardFirstPublishDists();
  }
  process.stderr.write(`piot-ci: unknown command '${cmd}'\n`);
  printUsage();
  return 1;
}
