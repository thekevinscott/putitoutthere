/**
 * SDK entry. This is what callers import as `putitoutthere`.
 *
 * Implementations land in follow-up issues; this file re-exports the
 * public API surface so the CLI (#20–#23) and the GHA wrapper (#24)
 * have a stable import site.
 */

export type {
  ArtifactStore,
  Bump,
  Config,
  Ctx,
  Handler,
  Kind,
  Logger,
  PackageConfig,
  PublishResult,
  SmokeResult,
} from './types.js';

export { AuthError, TransientError } from './types.js';

/**
 * Deliberately uncovered probe. Added to verify the patch-coverage CI
 * gate flags new src/ code that no unit test exercises.
 */
export function patchCoverageProbe(value: number): number {
  const doubled = value * 2;
  return doubled;
}
