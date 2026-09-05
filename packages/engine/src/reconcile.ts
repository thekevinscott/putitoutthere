/**
 * `putitoutthere reconcile` — backfill the missing git tag for every
 * package whose live registry version has no tag. The on-demand
 * companion to the publish-path auto-heal (#407): auto-heal only fires
 * for a package already in a publish run, so a package whose globs never
 * change again stays stuck forever; `reconcile` heals it without a
 * release.
 *
 * The healable condition is stated in terms of the registry, not the
 * drift label (#623): the version that IS live must have a tag. That
 * covers `status`'s `published, untagged` (no tags at all) and the
 * steady-state `version mismatch` a delegated PyPI upload leaves behind
 * — the previous release is tagged, the version the caller-side
 * `pypi-publish` job just uploaded is not. It is also why this is the
 * command that job runs after uploading: the tag then follows registry
 * truth rather than a step's exit code. A tag *ahead* of the registry
 * (cut but not yet published) is a different drift class and is left
 * alone — its registry version already carries its own, older tag.
 *
 * Thin reader, no parallel logic (design-commitments #7): `computeStatus`
 * (#403) finds the drift, `resolveTagCommit` picks the commit, and
 * `ensureTag` (#407) writes the tag. reconcile owns no copy of the
 * registry, tag, or drift logic — so it can never heal a drift `status`
 * wouldn't report or write a tag a release wouldn't. Idempotent:
 * `ensureTag` no-ops when the tag already exists, so a re-run does
 * nothing.
 *
 * `--expect` (#666) replaces discovery with a caller-asserted
 * `package@version`: `computeStatus`'s `latestVersion` reads a mutable,
 * CDN-cached pointer that can still name the previous release seconds
 * after a delegated PyPI upload, silently skipping the tag it was run to
 * cut. See `reconcile-expect.ts`.
 *
 * Issue #410, #403 slice 3, #623, #666.
 */

import { join } from 'node:path';

import { loadConfig, type Package } from './config.js';
import { ensureTag } from './ensure-tag.js';
import { tagList } from './git.js';
import { createLogger } from './log.js';
import { reconcileExpected } from './reconcile-expect.js';
import { resolveTagCommit } from './resolve-tag-commit.js';
import { computeStatus } from './status.js';
import { formatTag } from './tag-template.js';
import type { ReconcileAction, ReconcileOptions, ReconcileResult } from './reconcile-types.js';

export async function reconcile(opts: ReconcileOptions): Promise<ReconcileResult> {
  const cwd = opts.cwd;
  const cfgPath = opts.configPath ?? join(cwd, 'putitoutthere.toml');
  const dryRun = opts.dryRun ?? false;
  const log = createLogger();

  const config = await loadConfig(cfgPath);
  const byName = new Map<string, Package>(config.packages.map((p) => [p.name, p]));

  if (opts.expect !== undefined) {
    const actions = await reconcileExpected(opts.expect, config, byName, cwd, dryRun, log);
    return { ok: true, dryRun, actions };
  }

  const rows = await computeStatus({ cwd, configPath: cfgPath });

  const actions: ReconcileAction[] = [];
  for (const row of rows) {
    // Nothing to back-fill without a live version to back-fill to:
    // `unreleased` and `tagged, unpublished` name versions that are not
    // on the registry, and an unreachable registry is not evidence of
    // anything. A missing tag would not fix either.
    if (row.registryUnreachable || row.registry === null) {continue;}
    const pkg = byName.get(row.package)!;
    const version = row.registry;
    const tag = formatTag(pkg.tag_format, { name: pkg.name, version });
    // Already tagged => nothing to do. This is what keeps the widened
    // condition (#623) from re-tagging on every drift state: a package
    // whose newest tag is *ahead* of the registry still has a tag for the
    // registry's own version, so it lands here and is skipped.
    if ((await tagList(tag, { cwd })).length > 0) {continue;}
    const siblings = config.packages.filter((p) => p.name !== row.package);
    const { commit, source } = await resolveTagCommit(version, siblings, { cwd });
    if (!dryRun) {
      await ensureTag(pkg.tag_format, pkg.name, version, commit, { cwd }, log);
    }
    actions.push({ package: pkg.name, kind: pkg.kind, version, tag, commit, source, created: !dryRun });
  }

  return { ok: true, dryRun, actions };
}
