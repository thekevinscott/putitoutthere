/**
 * `piot-ci` — dispatcher for putitoutthere's repo-internal CI gates.
 *
 * The gates that today live as inline bash in `.github/workflows/**` (the
 * evidence-check, changelog, and patch-coverage gates, fixture-harness
 * setup) are being extracted into tested TypeScript under
 * `packages/ci/src/<gate>/` and invoked through this bin — never as
 * authored code in `.github/`, never by a `dist/` path. See AGENTS.md >
 * "Repo-internal CI gates". This is the dispatcher skeleton; each gate
 * registers as a subcommand in its own PR.
 *
 * Returns the process exit code.
 */

import { runActionlintIdToken } from './actionlint-idtoken/run.js';
import { runChangelogCheck } from './changelog-check/run.js';
import { runTddLint } from './tdd-lint/run.js';
import { printUsage } from './usage.js';

export function run(argv: readonly string[]): number {
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
  process.stderr.write(`piot-ci: unknown command '${cmd}'\n`);
  printUsage();
  return 1;
}
