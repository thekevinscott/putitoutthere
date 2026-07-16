import { spawn } from 'node:child_process';
import { ExecError } from './exec-error.js';

export interface ExecInheritOptions {
  // `| undefined` is explicit so call sites can forward an optional field
  // directly (`{ cwd: opts.cwd }`) under exactOptionalPropertyTypes.
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

/**
 * Async replacement for `execFileSync(cmd, args, { stdio: 'inherit' })`:
 * the child streams straight to our stdout/stderr (publish logs, gh
 * release create). Resolves on exit 0; rejects with ExecError otherwise.
 * stdout/stderr on the error are empty strings — output already went to
 * the terminal.
 */
export function execInherit(
  cmd: string,
  args: readonly string[],
  opts: ExecInheritOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], { stdio: 'inherit', cwd: opts.cwd, env: opts.env });
    child.on('error', (err) => {
      reject(new ExecError(err.message, '', '', null, { cause: err }));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new ExecError(`Command failed: ${cmd} ${args.join(' ')}`, '', '', code));
    });
  });
}
