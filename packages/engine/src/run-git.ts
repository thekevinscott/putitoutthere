import type { GitOptions } from './git.js';
import { execCapture } from './utils/exec-capture.js';
import { ExecError } from './utils/exec-error.js';

export async function runGit(args: readonly [string, ...string[]], opts: GitOptions = {}): Promise<string> {
  try {
    return (await execCapture('git', args, { cwd: opts.cwd })).stdout.trimEnd();
  } catch (err) {
    // execCapture rejects with an ExecError whose `stderr` field carries
    // git's error output (already a string). Fold it into the thrown
    // message so tests + logs see the root cause without separate plumbing.
    const stderr = err instanceof ExecError ? err.stderr.trim() : undefined;
    const base = err instanceof Error ? err.message : String(err);
    // `git tag -a` on a runner with no user.name/email surfaces as
    // "Please tell me who you are" / "unable to auto-detect email
    // address". Give the adopter an actionable hint instead of the
    // bare git output. #206.
    const needsIdentity = Boolean(
      stderr?.match(/unable to auto-detect email address|Please tell me who you are/),
    );
    if (needsIdentity) {
      throw new Error(
        [
          // `args` is a non-empty tuple (`readonly [string, ...string[]]`),
          // so `args[0]` is always a `string` — no `?? ''` fallback needed.
          `git ${args[0]}: no committer identity configured.`,
          'piot cuts annotated tags which require `user.name` + `user.email`.',
          'Configure them in the publish job before invoking piot:',
          '  - run: |',
          '      git config --global user.name "github-actions[bot]"',
          '      git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"',
          'See https://thekevinscott.github.io/putitoutthere/guide/runner-prerequisites',
          '',
          `Underlying git output:\n${stderr}`,
        ].join('\n'),
        { cause: err },
      );
    }
    throw new Error(stderr ? `${base}\n${stderr}` : base, { cause: err });
  }
}
