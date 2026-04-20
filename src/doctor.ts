/**
 * `putitoutthere doctor` — pre-flight validator.
 *
 * Validates: config parses; every package has a resolvable kind; every
 * package has usable credentials (OIDC or per-kind token). Returns a
 * structured report rather than throwing so the CLI can render it as
 * a table.
 *
 * When `checkArtifacts` is on, also walks the plan and checks each
 * expected artifact directory. Silent-skips when plan can't run (no
 * git state / no commits) so `doctor` stays useful in contexts that
 * don't have a release history yet.
 *
 * Issue #23. Plan: §21.1, §16.4.7. Artifact check: #89.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expectedLayout, type MatrixRow } from './completeness.js';
import { loadConfig, type Package } from './config.js';
import { plan } from './plan.js';
import { checkAuth, type AuthResult } from './preflight.js';

export interface DoctorOptions {
  cwd: string;
  configPath?: string;
  /** When true, walks the plan and checks each artifact dir exists. */
  checkArtifacts?: boolean;
}

export interface DoctorReport {
  ok: boolean;
  issues: string[];
  packages: Array<{
    name: string;
    kind: string;
    auth: AuthResult['via'];
  }>;
  artifacts?: Array<{
    package: string;
    target: string;
    artifact_name: string;
    present: boolean;
    expected: string;
  }>;
}

export async function doctor(opts: DoctorOptions): Promise<DoctorReport> {
  const issues: string[] = [];
  let config: { packages: Package[] } | null = null;

  /* v8 ignore next -- tests always pass an explicit cwd */
  const cfgPath =
    opts.configPath ?? `${opts.cwd.replace(/\/+$/, '')}/putitoutthere.toml`;

  try {
    config = loadConfig(cfgPath);
    /* v8 ignore start -- non-Error catch fallback path */
  } catch (err) {
    issues.push(
      `config: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  /* v8 ignore stop */

  const packages: DoctorReport['packages'] = [];

  if (config) {
    const auth = checkAuth(config.packages);
    for (const pkg of config.packages) {
      const row = auth.results.find((r) => r.package === pkg.name);
      /* v8 ignore next -- every cascaded package has a row in checkAuth */
      const via = row?.via ?? 'missing';
      packages.push({ name: pkg.name, kind: pkg.kind, auth: via });
      if (via === 'missing') {
        issues.push(
          `auth: ${pkg.name} (${pkg.kind}) needs ${row?.acceptedEnvVars.join(' or ') ?? '<env-var>'} or OIDC`,
        );
      }
    }
  }

  const artifacts = opts.checkArtifacts && config
    ? await checkArtifacts(opts, cfgPath, issues)
    : undefined;

  return {
    ok: issues.length === 0,
    issues,
    packages,
    ...(artifacts !== undefined ? { artifacts } : {}),
  };
}

async function checkArtifacts(
  opts: DoctorOptions,
  cfgPath: string,
  issues: string[],
): Promise<DoctorReport['artifacts']> {
  let matrix: MatrixRow[];
  try {
    matrix = (await plan({ cwd: opts.cwd, configPath: cfgPath })) as MatrixRow[];
  } catch (err) {
    // Plan needs a git repo with at least one commit. In a scratch
    // checkout (no git state yet) we can't walk the plan at all, so
    // we note it as a soft issue and move on.
    /* v8 ignore next -- non-Error catch fallback path */
    const message = err instanceof Error ? err.message : String(err);
    issues.push(`artifacts: cannot walk plan (${message})`);
    return [];
  }

  const root = join(opts.cwd, 'artifacts');
  const rows: NonNullable<DoctorReport['artifacts']> = [];
  for (const row of matrix) {
    // Vanilla npm publishes from the source tree; there's no separate
    // artifact dir to check. Mirrors completeness.ts's carve-out.
    if (row.kind === 'npm' && row.target === 'noarch') continue;
    const dir = join(root, row.artifact_name);
    const present = existsSync(dir);
    const expected = expectedLayout(row);
    rows.push({
      package: row.name,
      target: row.target,
      artifact_name: row.artifact_name,
      present,
      expected,
    });
    if (!present) {
      issues.push(`artifacts: ${row.name} (${row.target}) missing; expected ${expected}`);
    }
  }
  return rows;
}
