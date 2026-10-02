/**
 * `putitoutthere fold-bundle` — synthesize the action-bundle commit (#446).
 * `dist-action/` is gitignored on main, so the built bundle is staged and
 * committed onto HEAD, forwarding the parent's body so a `release:` trailer
 * survives — otherwise plan re-derivation silently downgrades to `patch`.
 */

import { addForce, commitBody, commitWithBody, hasStagedChanges } from './git.js';

export async function foldActionBundle(opts: { cwd: string; subject: string }): Promise<number> {
  const gitOpts = { cwd: opts.cwd };
  await addForce('dist-action/', gitOpts);
  if (!(await hasStagedChanges(gitOpts))) {
    throw new Error(
      'No bundle changes to commit (unexpected — build:action should have produced output).',
    );
  }
  const parentBody = await commitBody('HEAD', gitOpts);
  await commitWithBody(opts.subject, parentBody, gitOpts);
  return 0;
}
