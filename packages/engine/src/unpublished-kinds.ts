/**
 * The registry kinds a planned release still has work for (#622): distinct
 * `kind`s with a package whose planned version is not yet on its registry.
 * `release.yml` gates registry auth on this, so a re-run with nothing left to
 * ship needs no crates.io OIDC. `unknown` counts as unpublished, never as done.
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
