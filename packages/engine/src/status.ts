/**
 * `putitoutthere status` — read-only registry-vs-tag drift report.
 *
 * The registry is the source of truth; git tags are a cache. For each
 * configured package this reconciles the latest git tag (via the same
 * `lastTag` resolver the planner and the publish path use) against the
 * registry's latest published version (via the same per-kind handler the
 * publish path dispatches through), and classifies any drift. No auth,
 * no side effects — git + public registry metadata only.
 *
 * Shared engine, no parallel logic (design-commitments #7): a thin
 * reader over `lastTag` + `handler.latestVersion` + `classify`. It
 * carries no copy of the tag, version, or registry logic the release
 * path owns, so `status` and a real release can never disagree.
 *
 * Issue #403, phase 1. v1 reports the drift-defining pair only — latest
 * tag vs registry latest; the `manifest` and `publisher` columns from
 * the issue mockup are later enrichments. The drift taxonomy lives in
 * `status-classify.ts`; rendering in `status-format.ts`.
 */

import { join } from 'node:path';

import { loadConfig } from './config.js';
import { lastTag } from './git.js';
import { handlerFor as defaultHandlerFor } from './handlers/index.js';
import { createLogger } from './log.js';
import { classify, DRIFT_STATES } from './status-classify.js';
import { parseTagVersion } from './tag-template.js';
import type { Ctx } from './types.js';
import type { StatusOptions, StatusRow } from './status-types.js';

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
  const ctx: Ctx = {
    cwd,
    log: createLogger(),
    env: process.env as Record<string, string>,
    artifacts: { get: () => '', has: () => false },
  };

  const rows: StatusRow[] = [];
  for (const pkg of config.packages) {
    const tag = await lastTag(pkg.name, pkg.tag_format, { cwd });
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
