/**
 * `putitoutthere plan` publish/skip + skew view (#412, #403 slice 4).
 *
 * Layers a per-package verdict over the build matrix: for each planned
 * package, would a release from this ref PUBLISH (version not yet on the
 * registry), SKIP (already published), or is the registry UNKNOWN
 * (unreachable). Plus dependency skew — a dependent that would PUBLISH
 * while a `depends_on` dependency SKIPs.
 *
 * Thin reader, no parallel logic (design-commitments #7): the real
 * planner (`plan` — cascade + version) gives the matrix, and the same
 * `handler.isPublished` the publish path dispatches through gives the
 * verdict. So the preview can't disagree with what a release would do.
 * The read degrades, never aborts: an unreachable registry yields
 * `unknown` and the matrix is still returned — same posture as `status`.
 *
 * The `matrix` field is byte-identical to bare `plan` output, so the
 * reusable workflow's matrix contract is unchanged; verdicts are
 * additive.
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
  const config = loadConfig(cfgPath);
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
