/**
 * `reconcile` shared types: one healed (or, under --dry-run, planned)
 * tag, and the options / result shapes the command and its renderer pass
 * around.
 *
 * Issue #410, #403 slice 3.
 */

import type { Kind } from './types.js';

export interface ReconcileAction {
  /** piot package id — the `{name}` in the tag template. */
  package: string;
  kind: Kind;
  /** The live registry version the missing tag is backfilled to. */
  version: string;
  /** The tag that was (or, under --dry-run, would be) created. */
  tag: string;
  /** The commit the tag points at. */
  commit: string;
  /** Where `commit` came from: a sibling package's tag, or HEAD. */
  source: 'sibling' | 'head';
  /** False under --dry-run (planned, not written). */
  created: boolean;
}

export interface ReconcileResult {
  ok: true;
  dryRun: boolean;
  actions: ReconcileAction[];
}

export interface ReconcileOptions {
  cwd: string;
  /** Defaults to `${cwd}/putitoutthere.toml`. */
  configPath?: string;
  /** Report what would be created without writing any tag. */
  dryRun?: boolean;
}
