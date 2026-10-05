/**
 * `reconcile --expect`: confirm caller-asserted `package@version` pairs against
 * each registry's IMMUTABLE per-version endpoint, not the mutable latest
 * pointer — pypi.org's `/pypi/{name}/json` is CDN-cached (`max-age=900`), so
 * bare `reconcile` after a delegated upload can cut no tag at all (#666).
 */

import type { Config, Package } from './config.js';
import { ensureTag } from './ensure-tag.js';
import { tagList } from './git.js';
import { handlerFor as defaultHandlerFor } from './handlers/index.js';
import { parseReconcileExpect } from './parse-reconcile-expect.js';
import type { ReconcileAction } from './reconcile-types.js';
import { resolveTagCommit } from './resolve-tag-commit.js';
import { formatTag } from './tag-template.js';
import type { Ctx, Logger } from './types.js';

export async function reconcileExpected(
  raw: string,
  config: Config,
  byName: ReadonlyMap<string, Package>,
  cwd: string,
  dryRun: boolean,
  log: Logger,
): Promise<ReconcileAction[]> {
  const ctx: Ctx = {
    cwd,
    log,
    env: process.env as Record<string, string>,
    artifacts: { get: () => '', has: () => false },
  };

  const actions: ReconcileAction[] = [];
  for (const { name, version } of parseReconcileExpect(raw)) {
    const pkg = byName.get(name);
    if (pkg === undefined) {
      throw new Error(`reconcile --expect: "${name}" is not a package name in putitoutthere.toml`);
    }
    const tag = formatTag(pkg.tag_format, { name: pkg.name, version });
    // Already tagged => idempotent no-op, matching bare reconcile. No
    // need to confirm against the registry at all.
    if ((await tagList(tag, { cwd })).length > 0) {continue;}
    const confirmed = await defaultHandlerFor(pkg.kind).isPublished(pkg, version, ctx);
    if (!confirmed) {
      throw new Error(
        `reconcile --expect: ${pkg.name}@${version} not found on the ${pkg.kind} registry`,
      );
    }
    const siblings = config.packages.filter((p) => p.name !== pkg.name);
    const { commit, source } = await resolveTagCommit(version, siblings, { cwd });
    if (!dryRun) {
      await ensureTag(pkg.tag_format, pkg.name, version, commit, { cwd }, log);
    }
    actions.push({ package: pkg.name, kind: pkg.kind, version, tag, commit, source, created: !dryRun });
  }
  return actions;
}
