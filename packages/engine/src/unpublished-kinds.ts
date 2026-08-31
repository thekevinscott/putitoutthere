/**
 * The registry kinds a planned release still has work for (#622).
 *
 * Distinct `kind`s carrying at least one package whose planned version is
 * NOT already on its registry, in first-seen order. The reusable workflow
 * gates registry authentication on this: `release.yml` used to ask the build
 * matrix "does this repo have a crates package?", which is true whenever a
 * crate exists — published or not — so the crates.io OIDC exchange fired on
 * re-runs with nothing left to ship, and a failing exchange killed the
 * publish job before npm and PyPI got their turn.
 *
 * `unknown` (the registry could not be reached, so `plan` degraded rather
 * than aborting) counts as unpublished. Reading "we could not tell" as
 * "nothing to do" would drop the credential a publish may well still need,
 * turning a registry blip at plan time into an auth failure at publish time;
 * listing the kind preserves the pre-#622 behaviour in exactly that case.
 */

import type { PlanVerdict } from './plan-status-types.js';
import type { Kind } from './types.js';

export function unpublishedKinds(verdicts: readonly PlanVerdict[]): Kind[] {
  const kinds: Kind[] = [];
  for (const verdict of verdicts) {
    if (verdict.verdict === 'skip') {continue;}
    if (!kinds.includes(verdict.kind)) {kinds.push(verdict.kind);}
  }
  return kinds;
}
