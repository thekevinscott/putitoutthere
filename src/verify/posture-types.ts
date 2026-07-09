/**
 * `verify` shared types: per package, how its latest release authenticated
 * to the registry.
 *
 * Issue #414, #403 slice 5.
 */

import type { Kind, TrustPosture } from '../types.js';

/**
 * `oidc` / `token` come from the handler's trust read; `unpublished` when
 * there is no release to attribute; `unreachable` when the registry read
 * failed (reported, never gated).
 */
export type Posture = TrustPosture | 'unpublished' | 'unreachable';

export interface VerifyRow {
  package: string;
  kind: Kind;
  /** Latest published version, or null when never published / unreachable. */
  version: string | null;
  posture: Posture;
}

export interface VerifyOptions {
  cwd: string;
  /** Defaults to `${cwd}/putitoutthere.toml`. */
  configPath?: string;
}
