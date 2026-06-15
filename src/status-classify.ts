/**
 * Classify one package's drift state from its {latest tag version,
 * registry latest}. Pure — the registry/tag reads happen in
 * `computeStatus`. `DRIFT_STATES` is the subset a `status --check` gate
 * fails on.
 *
 * Issue #403.
 */

import type { StatusState } from './status-types.js';

/** States a `status --check` gate treats as failing drift. */
export const DRIFT_STATES: ReadonlySet<StatusState> = new Set<StatusState>([
  'published, untagged',
  'tagged, unpublished',
  'version mismatch',
]);

/**
 * `registryUnreachable` short-circuits to a non-drift "unreachable"
 * state so a registry blip never trips a `--check` gate.
 */
export function classify(
  tagVersion: string | null,
  registry: string | null,
  registryUnreachable: boolean,
): StatusState {
  if (registryUnreachable) {return 'registry unreachable';}
  if (tagVersion === null && registry === null) {return 'unreleased';}
  if (tagVersion === null) {return 'published, untagged';}
  if (registry === null) {return 'tagged, unpublished';}
  if (tagVersion === registry) {return 'in sync';}
  return 'version mismatch';
}
