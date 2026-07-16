/**
 * `putitoutthere reconcile` — backfill the missing git tag for every
 * package that is live on its registry but untagged (`status`'s
 * `published, untagged` drift). The on-demand companion to the
 * publish-path auto-heal (#407): auto-heal only fires for a package
 * already in a publish run, so a package whose globs never change again
 * stays stuck forever; `reconcile` heals it without a release.
 *
 * Thin reader, no parallel logic (design-commitments #7): `computeStatus`
 * (#403) finds the drift, `resolveTagCommit` picks the commit, and
 * `ensureTag` (#407) writes the tag. reconcile owns no copy of the
 * registry, tag, or drift logic — so it can never heal a drift `status`
 * wouldn't report or write a tag a release wouldn't. Idempotent:
 * `ensureTag` no-ops when the tag already exists, so a re-run does
 * nothing.
 *
 * Issue #410, #403 slice 3.
 */

import { join } from 'node:path';

import { loadConfig, type Package } from './config.js';
import { ensureTag } from './ensure-tag.js';
import { createLogger } from './log.js';
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
  const rows = await computeStatus({ cwd, configPath: cfgPath });

  const actions: ReconcileAction[] = [];
  for (const row of rows) {
    // Only published-but-untagged is healable by writing a tag.
    // version-mismatch and tagged-unpublished are different drift classes
    // a missing tag would not fix.
    if (row.state !== 'published, untagged') {continue;}
    const pkg = byName.get(row.package)!;
    const version = row.registry!;
    const siblings = config.packages.filter((p) => p.name !== row.package);
    const { commit, source } = await resolveTagCommit(version, siblings, { cwd });
    const tag = formatTag(pkg.tag_format, { name: pkg.name, version });
    if (!dryRun) {
      await ensureTag(pkg.tag_format, pkg.name, version, commit, { cwd }, log);
    }
    actions.push({ package: pkg.name, kind: pkg.kind, version, tag, commit, source, created: !dryRun });
  }

  return { ok: true, dryRun, actions };
}
