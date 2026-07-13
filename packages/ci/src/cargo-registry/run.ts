/**
 * Mode dispatcher for the cargo-http-registry harness (#454). Routes the
 * `start` and `diagnose` sub-commands to their composition roots and rejects
 * an unknown/missing mode. Both real steps are invoked as
 * `pnpm exec piot-ci cargo-registry <mode>`.
 */

import { runCargoRegistryDiagnose } from './run-diagnose.js';
import { runCargoRegistryStart } from './run-start.js';

export function runCargoRegistry(argv: readonly string[]): number {
  const mode = argv[3];
  if (mode === 'start') {
    return runCargoRegistryStart();
  }
  if (mode === 'diagnose') {
    return runCargoRegistryDiagnose();
  }
  process.stdout.write(`::error::cargo-registry: mode must be one of start|diagnose (got ${mode ?? '<none>'}).\n`);
  return 1;
}
