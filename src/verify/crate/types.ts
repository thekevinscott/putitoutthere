/**
 * Option + row shapes for `verify crate` (#449).
 */

export interface VerifyCrateOptions {
  /** The plan matrix JSON the workflow already carries. */
  matrix: string;
  /**
   * The `cargo-http-registry` disk root the engine published to. `.crate`
   * files are read straight off this path — same host, same job, no fetch.
   */
  registryRoot: string;
}

export interface CrateRow {
  name: string;
  kind: string;
  version: string;
}
