/**
 * Render one GitHub workflow annotation per row `reconcile` declined to
 * decide (#694).
 *
 * A skip that can lose a tag has to be visible. `pypi-tag` reported
 * `{"ok":true,"dryRun":false,"actions":[]}` for a PyPI package it never
 * tagged, and that line is the whole record a consumer had — exit 0, no
 * action, no reason, the tag silently absent. `::warning::` is the one
 * channel that reaches the job summary and the PR's Files view without
 * failing the job, which is what this needs: an unreadable registry is a
 * "re-run me" condition, not a release failure (bare `reconcile` walks
 * every configured package, so a crates.io blip must not red-light a
 * consumer's PyPI tagging job).
 *
 * Pure: the caller writes the lines, as `preflight.ts`'s
 * `warnIndeterminate` does, so the decision is testable without a stdout
 * spy.
 */

import type { ReconcileSkip } from './reconcile-types.js';

export function reconcileSkipWarnings(skipped: readonly ReconcileSkip[]): string[] {
  return skipped.map(
    (skip) =>
      `::warning::reconcile: could not read the ${skip.kind} registry for ` +
      `${skip.package}; left undecided, so a tag may be missing. ` +
      `Re-run reconcile once the registry is reachable.`,
  );
}
