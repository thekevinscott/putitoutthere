/**
 * `putitoutthere fold-bundle` — synthesize the action-bundle commit
 * (#446, epic #442).
 *
 * Extraction of the identical Fold step both `release-npm.yml` and
 * `advance-v0.yml` carried inline (they differed only in the commit
 * subject). `dist-action/` is gitignored on main and exists only on tag
 * commits, so before a tag can point at a commit that has
 * `dist-action/index.js`, the freshly-built bundle is staged and committed
 * on top of HEAD.
 *
 * The new commit forwards the parent's full body under `subject` so any
 * `release:` trailer the operator wrote survives into HEAD — otherwise the
 * publish-time plan re-derivation reads a trailer-less bundle commit,
 * defaults the bump to `patch`, and silently downgrades the release (the
 * 0.2.0-landed-as-0.1.52 incident; notes/handoff/2026-04-24-dist-action.md).
 *
 * Throws when nothing is staged — `build:action` should always have
 * produced output, so an empty index is an unexpected state the release
 * must abort on rather than commit nothing (matches the bash
 * `git diff --cached --quiet` guard).
 */

import { addForce, commitBody, commitWithBody, hasStagedChanges } from './git.js';

export function foldActionBundle(opts: { cwd: string; subject: string }): number {
  const gitOpts = { cwd: opts.cwd };
  addForce('dist-action/', gitOpts);
  if (!hasStagedChanges(gitOpts)) {
    throw new Error(
      'No bundle changes to commit (unexpected — build:action should have produced output).',
    );
  }
  const parentBody = commitBody('HEAD', gitOpts);
  commitWithBody(opts.subject, parentBody, gitOpts);
  return 0;
}
