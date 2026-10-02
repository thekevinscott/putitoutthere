/**
 * `reconcile` shared types: one healed (or, under --dry-run, planned)
 * tag, one row the command declined to decide, and the options / result
 * shapes the command and its renderer pass around.
 *
 * Issue #410, #403 slice 3, #694.
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

/**
 * A package the discovery pass could not decide about (#694).
 *
 * `actions: []` has two very different meanings — "every live version
 * already has its tag" and "I could not read the registry, so I have no
 * idea" — and a consumer whose PyPI tag went missing had only the first
 * to go on. This separates them.
 *
 * Deliberately NOT emitted for a package that is simply unpublished: a
 * registry that answers "no such version" has answered, and every
 * package a repo has not shipped yet is in that state permanently, so
 * reporting it would bury the one row that matters.
 */
export interface ReconcileSkip {
  /** piot package id. */
  package: string;
  kind: Kind;
  /** The one reason so far; a union keeps the renderer honest if more land. */
  reason: 'registry-unreachable';
}

export interface ReconcileResult {
  ok: true;
  dryRun: boolean;
  actions: ReconcileAction[];
  /**
   * Rows that produced no action for a reason that is not evidence of
   * anything. Always present (empty on the `--expect` path, which names
   * exact versions and throws rather than skipping), so a consumer can
   * read it without checking whether the key exists.
   */
  skipped: ReconcileSkip[];
}

export interface ReconcileOptions {
  cwd: string;
  /** Defaults to `${cwd}/putitoutthere.toml`. */
  configPath?: string;
  /** Report what would be created without writing any tag. */
  dryRun?: boolean;
  /**
   * `<name>@<version>`, or a JSON array of `{name, version, ...}` (#666).
   * When present, reconcile confirms exactly these package/version pairs
   * against the registry's per-version endpoint and tags them, skipping
   * latest-version discovery entirely — see `reconcile-expect.ts`.
   */
  expect?: string;
}
