/**
 * `putitoutthere status` — read-only registry-vs-tag drift report.
 *
 * The registry is the source of truth; git tags are a cache. For each
 * configured package this reconciles the latest git tag (via the same
 * `lastTag` resolver the planner and the publish path use) against the
 * registry's latest published version (via the same per-kind handler the
 * publish path dispatches through), and classifies any drift between the
 * two. No auth, no side effects — git + public registry metadata only.
 *
 * Shared engine, no parallel logic (design-commitments #7): this is a
 * thin reader over `lastTag` and `handler.latestVersion`. It carries no
 * copy of the tag, version, or registry logic the release path owns, so
 * `status` and a real release can never disagree about what is published
 * or tagged.
 *
 * Issue #403, phase 1. v1 reports the drift-defining pair only — latest
 * tag vs registry latest; the `manifest` and `publisher` columns from
 * the issue mockup are later enrichments.
 */

import { join } from 'node:path';

import { loadConfig } from './config.js';
import { lastTag } from './git.js';
import { handlerFor as defaultHandlerFor } from './handlers/index.js';
import { createLogger } from './log.js';
import { parseTagVersion } from './tag-template.js';
import type { Ctx, Handler, Kind } from './types.js';

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

const DRIFT_STATES: ReadonlySet<StatusState> = new Set<StatusState>([
  'published, untagged',
  'tagged, unpublished',
  'version mismatch',
]);

/**
 * Reconcile every configured package's latest tag against its registry
 * latest. Read-only; makes one unauthenticated registry request per
 * package and never mutates anything.
 */
export async function computeStatus(opts: StatusOptions): Promise<StatusRow[]> {
  const cwd = opts.cwd;
  const cfgPath = opts.configPath ?? join(cwd, 'putitoutthere.toml');
  const handlerFor = opts.handlerFor ?? defaultHandlerFor;
  const config = loadConfig(cfgPath);
  const ctx = readonlyCtx(cwd);

  const rows: StatusRow[] = [];
  for (const pkg of config.packages) {
    const tag = lastTag(pkg.name, pkg.tag_format, { cwd });
    const tagVersion = tag === null ? null : parseTagVersion(pkg.tag_format, pkg.name, tag);

    let registry: string | null = null;
    let registryUnreachable = false;
    try {
      registry = await handlerFor(pkg.kind).latestVersion(pkg, ctx);
    } catch {
      // 5xx / network / timeout / malformed response: a read-only report
      // surfaces "unreachable" rather than aborting or claiming drift.
      registryUnreachable = true;
    }

    const state = classify(tagVersion, registry, registryUnreachable);
    rows.push({
      package: pkg.name,
      kind: pkg.kind,
      tag,
      tagVersion,
      registry,
      registryUnreachable,
      state,
      drift: DRIFT_STATES.has(state),
    });
  }
  return rows;
}

/**
 * Classify one package from its {latest tag version, registry latest}.
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

/** Single-line, monospace-friendly render of one row. */
export function formatStatusRow(row: StatusRow): string {
  const tagCol = row.tagVersion ?? '—';
  const registryCol = row.registryUnreachable ? 'unreachable' : (row.registry ?? '—');
  return `${row.package}  tag=${tagCol}  registry=${registryCol}  ${markFor(row)} ${row.state}`;
}

/* ----------------------------- internals ----------------------------- */

function markFor(row: StatusRow): string {
  if (row.drift) {return '⚠';}
  if (row.registryUnreachable) {return '?';}
  return '✓';
}

function readonlyCtx(cwd: string): Ctx {
  return {
    cwd,
    log: createLogger(),
    env: process.env as Record<string, string>,
    artifacts: { get: () => '', has: () => false },
  };
}
