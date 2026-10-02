/**
 * `putitoutthere plan` publish/skip + skew view (#412, #403 slice 4). Layers a
 * per-package verdict over the build matrix — PUBLISH / SKIP / UNKNOWN — via
 * the same `handler.isPublished` the publish path uses, so the preview cannot
 * disagree with what a release would do. `matrix` stays byte-identical to bare
 * `plan`, and an unreachable registry degrades to `unknown` rather than abort.
 */

import { join } from 'node:path';

import { loadConfig, type Package } from './config.js';
import { handlerFor } from './handlers/index.js';
import { createLogger } from './log.js';
import { plan } from './plan.js';
import { computeSkew } from './plan-skew.js';
import type { Ctx } from './types.js';
import type { PlanStatus, PlanStatusOptions, PlanVerdict, Verdict } from './plan-status-types.js';

export async function computePlanStatus(opts: PlanStatusOptions): Promise<PlanStatus> {
  const cwd = opts.cwd;
  const cfgPath = opts.configPath ?? join(cwd, 'putitoutthere.toml');
  const config = await loadConfig(cfgPath);
  const ctx: Ctx = {
    cwd,
    log: createLogger(),
    env: process.env as Record<string, string>,
    artifacts: { get: () => '', has: () => false },
  };

  const matrix = await plan({
    cwd,
    configPath: cfgPath,
    releasePackages: opts.releasePackages,
  });

  // One verdict per planned package — rows share a single version. Keep
  // first-seen matrix order so the output is stable.
  const byName = new Map<string, Package>(config.packages.map((p) => [p.name, p]));
  const verdicts: PlanVerdict[] = [];
  const seen = new Set<string>();
  for (const row of matrix) {
    if (seen.has(row.name)) {continue;}
    seen.add(row.name);
    const pkg = byName.get(row.name)!;
    let verdict: Verdict;
    try {
      verdict = (await handlerFor(pkg.kind).isPublished(pkg, row.version, ctx)) ? 'skip' : 'publish';
    } catch {
      // 5xx / network / timeout: a read-only preview reports `unknown`
      // rather than aborting the plan.
      verdict = 'unknown';
    }
    verdicts.push({ package: row.name, kind: row.kind, version: row.version, verdict });
  }

  return { matrix, verdicts, skew: computeSkew(verdicts, byName) };
}
