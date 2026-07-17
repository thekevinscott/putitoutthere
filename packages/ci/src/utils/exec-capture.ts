// Deliberate duplicate of packages/engine/src/utils/exec-capture.ts (#469) — the ci package is private and the engine does not export internals.
import { execFile } from 'node:child_process';
import { ExecError } from './exec-error.js';

export interface ExecCaptureOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Async replacement for
 * `execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] })`.
 * Output is captured, never inherited. Rejects with ExecError carrying
 * the exit status and both streams as strings.
 *
 * Deliberately a hand-rolled Promise (not `util.promisify`) so behavior is
 * explicit and tests are simple.
 */
export function execCapture(
  cmd: string,
  args: readonly string[],
  opts: ExecCaptureOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      [...args],
      { encoding: 'utf8', cwd: opts.cwd, env: opts.env, maxBuffer: opts.maxBuffer },
      (err, stdout, stderr) => {
        if (err) {
          const code: unknown = (err as { code?: unknown }).code;
          const status = typeof code === 'number' ? code : null;
          reject(new ExecError(err.message, stdout, stderr, status, { cause: err }));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}
