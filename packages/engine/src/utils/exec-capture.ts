import { execFile } from 'node:child_process';
import { boundCapture } from './bound-capture.js';
import { ExecError } from './exec-error.js';

export interface ExecCaptureOptions {
  // `| undefined` is explicit so call sites can forward an optional field
  // directly (`{ cwd: opts.cwd }`) under exactOptionalPropertyTypes.
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  /** Retained output per stream, in characters. Defaults to CAPTURE_CEILING. */
  maxBuffer?: number | undefined;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * A cold `cargo publish --verbose` of a mid-sized crate was measured at ~380KB
 * of stderr (#651), so an ordinary build stays whole and the elision path
 * stays theoretical.
 */
const CAPTURE_CEILING = 8 * 1024 * 1024;

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
  const ceiling = opts.maxBuffer ?? CAPTURE_CEILING;
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      [...args],
      // Infinity, not `ceiling`: execFile's overflow policy is to raise
      // ERR_CHILD_PROCESS_STDIO_MAXBUFFER and SIGTERM the child, so a real
      // number here kills a publish for being verbose and reports a failure
      // the tool never produced (#664). Bound what we keep instead.
      { encoding: 'utf8', cwd: opts.cwd, env: opts.env, maxBuffer: Infinity },
      (err, stdout, stderr) => {
        const out = boundCapture(stdout, ceiling);
        const errOut = boundCapture(stderr, ceiling);
        if (err) {
          const code: unknown = (err as { code?: unknown }).code;
          const status = typeof code === 'number' ? code : null;
          reject(
            new ExecError(boundCapture(err.message, ceiling), out, errOut, status, {
              cause: err,
              command: [cmd, ...args],
            }),
          );
          return;
        }
        resolve({ stdout: out, stderr: errOut });
      },
    );
  });
}
