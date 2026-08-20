/**
 * Error thrown by the process seam (execCapture / execInherit) when a
 * subprocess exits non-zero, is killed by a signal, or fails to spawn.
 * Mirrors the fields call sites read off execFileSync errors:
 * `status` (exit code) and captured `stdout`/`stderr` as strings.
 */

export interface ExecErrorOptions extends ErrorOptions {
  /**
   * argv of the failing command (`['npm', 'publish', '--access=public']`),
   * when the seam recorded it. Carried so the failure dump can report what
   * actually ran instead of an empty command — handlers wrap this error in
   * a rendered message, and that message never holds the argv. #617.
   */
  command?: readonly string[];
}

export class ExecError extends Error {
  /** argv of the failing command; empty when the seam did not record it. */
  readonly command: readonly string[];

  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    /** Exit code; null when killed by signal or failed to spawn (e.g. ENOENT). */
    readonly status: number | null,
    options?: ExecErrorOptions,
  ) {
    super(message, options);
    this.name = 'ExecError';
    this.command = options?.command ?? [];
  }
}
