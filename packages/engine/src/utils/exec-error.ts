/**
 * Error thrown by the process seam (execCapture / execInherit) when a
 * subprocess exits non-zero, is killed by a signal, or fails to spawn.
 * Mirrors the fields call sites read off execFileSync errors:
 * `status` (exit code) and captured `stdout`/`stderr` as strings.
 */
export class ExecError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    /** Exit code; null when killed by signal or failed to spawn (e.g. ENOENT). */
    readonly status: number | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ExecError';
  }
}
