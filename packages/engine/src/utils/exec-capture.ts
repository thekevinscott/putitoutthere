import { execFile } from 'node:child_process';
import { ExecError } from './exec-error.js';

export interface ExecCaptureOptions {
  // `| undefined` is explicit so call sites can forward an optional field
  // directly (`{ cwd: opts.cwd }`) under exactOptionalPropertyTypes.
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  maxBuffer?: number | undefined;
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
