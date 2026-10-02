/**
 * Decision core for the cargo-http-registry `start` mode (#454, epic #442).
 * I/O-free; the `::error::` text matches the "Start cargo-http-registry (#331)"
 * bash in `e2e-fixture-job.yml` exactly.
 */

export interface CargoRegistryStartInput {
  ready: boolean;
}

export interface CargoRegistryStartDecision {
  exitCode: number;
  /** The `::error::` header emitted before the raw log dump, or null on success. */
  errorLine: string | null;
  /** Whether to append the `[net] git-fetch-with-cli` block to cargo config. */
  writeConfig: boolean;
}

export function decideCargoRegistryStart(input: CargoRegistryStartInput): CargoRegistryStartDecision {
  if (input.ready) {
    return { exitCode: 0, errorLine: null, writeConfig: true };
  }
  return {
    exitCode: 1,
    errorLine: '::error::cargo-http-registry never came up; dumping log:',
    writeConfig: false,
  };
}
