/**
 * Everything the dump needs to describe the failure. Handlers build
 * this from their own state (the command they ran, the subprocess
 * output they captured, handler-specific extras like parsed wheel
 * tags). Nothing in here is putitoutthere-specific -- a fresh handler
 * can populate all fields from scratch.
 */
export interface FailureContext {
  /** Internal package name from pilot.toml. */
  package: string;
  /** Handler kind (crates | pypi | npm). */
  handler: string;
  /** The command that failed, argv-style. env values are redacted at emit. */
  command: readonly string[];
  /** stdout captured from the failing command. */
  stdout: string;
  /** stderr captured from the failing command. */
  stderr: string;
  /** Exit code (for child processes) or -1 when N/A. */
  exitCode: number;
  /** `{tool: "tool --version output"}`. Optional; handlers supply what's relevant. */
  toolVersions?: Record<string, string>;
  /**
   * Handler-specific diagnostic extras. Arbitrary key/value; rendered
   * verbatim in the summary. Examples from the plan: wheel platform
   * tags, npm tarball contents, cargo package --list output.
   */
  extras?: Record<string, unknown>;
}
