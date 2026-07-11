/**
 * `status` shared types: the drift-state vocabulary plus the row and
 * options shapes the status command and its renderer pass around.
 *
 * Issue #403.
 */

import type { Handler, Kind } from './types.js';

export type StatusState =
  | 'in sync'
  | 'unreleased'
  | 'published, untagged'
  | 'tagged, unpublished'
  | 'version mismatch'
  | 'registry unreachable';

export interface StatusRow {
  package: string;
  kind: Kind;
  /** Highest-semver git tag for this package, or null when none exists. */
  tag: string | null;
  /** Version parsed out of `tag`, or null when there is no tag. */
  tagVersion: string | null;
  /** Registry's latest published version, or null when never published. */
  registry: string | null;
  /** True when the registry could not be reached (rendered, not gated). */
  registryUnreachable: boolean;
  state: StatusState;
  /** Convenience: does `state` represent drift a `--check` gate fails on? */
  drift: boolean;
}

export interface StatusOptions {
  cwd: string;
  /** Defaults to `${cwd}/putitoutthere.toml`. */
  configPath?: string;
  /** Override for tests. Defaults to the real per-kind dispatcher. */
  handlerFor?: (kind: Kind) => Handler;
}
