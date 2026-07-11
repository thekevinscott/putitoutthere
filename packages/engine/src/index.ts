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
