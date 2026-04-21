/**
 * `putitoutthere preflight` — run every pre-publish check against every
 * package, without side effects.
 *
 * Lives alongside (not inside) `preflight.ts` because that module is
 * scoped to auth-only checks that handlers delegate to. This one is
 * the cross-cutting orchestrator that `doctor` and `publish` each use
 * pieces of.
 *
 * Issue #93. Plan: §16.4.7.
 *
 * Check catalogue:
 *   - path:       pkg.path exists on disk (resolved against opts.cwd).
 *   - manifest:   the per-kind manifest file exists under pkg.path.
 *   - auth:       OIDC or the per-kind token env var is set.
 *   - repository: package.json has `repository` (npm --provenance requirement).
 *   - artifact:   when the package is in the cascaded plan, its artifact
 *                 dir exists.
 *
 * Default scope is "packages cascaded by the plan". `--all` widens to
 * every configured package (useful pre-commit or when plan can't run
 * in a scratch checkout).
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { expectedLayout, type MatrixRow } from './completeness.js';
import { loadConfig, type Package } from './config.js';
import { plan } from './plan.js';
import { checkAuth } from './preflight.js';
import type { Kind } from './types.js';

export interface PreflightOptions {
  cwd: string;
  configPath?: string;
  /** When true, widen scope from cascaded-only to every configured package. */
  all?: boolean;
}

export type CheckStatus = 'ok' | 'fail' | 'skip';
export type CheckName = 'path' | 'manifest' | 'auth' | 'repository' | 'artifact';

export interface PreflightCheck {
  package: string;
  kind: Kind;
  check: CheckName;
  status: CheckStatus;
  detail?: string;
}

export interface PreflightReport {
  ok: boolean;
  checks: PreflightCheck[];
  /** Top-level issues not scoped to a package (e.g. config parse failure). */
  issues: string[];
}

export async function runPreflight(opts: PreflightOptions): Promise<PreflightReport> {
  const issues: string[] = [];
  const checks: PreflightCheck[] = [];

  /* v8 ignore next -- tests always pass an explicit configPath or cwd */
  const cfgPath =
    opts.configPath ?? `${opts.cwd.replace(/\/+$/, '')}/putitoutthere.toml`;

  let config: { packages: Package[] };
  try {
    config = loadConfig(cfgPath);
    /* v8 ignore start -- non-Error catch fallback path */
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    issues.push(`config: ${message}`);
    return { ok: false, checks, issues };
  }
  /* v8 ignore stop */

  // Anchor pkg.path to opts.cwd so every downstream fs op points at the
  // right tree (mirror src/publish.ts).
  for (const p of config.packages) {
    if (!isAbsolute(p.path)) p.path = resolve(opts.cwd, p.path);
  }

  let matrix: MatrixRow[] = [];
  try {
    matrix = (await plan({ cwd: opts.cwd, configPath: cfgPath })) as MatrixRow[];
  } catch (err) {
    /* v8 ignore next -- non-Error catch fallback path */
    const message = err instanceof Error ? err.message : String(err);
    issues.push(`plan: cannot compute matrix (${message})`);
  }

  const cascaded = new Set(matrix.map((r) => r.name));
  const scope = opts.all
    ? config.packages
    : config.packages.filter((p) => cascaded.has(p.name));

  const auth = checkAuth(scope);

  for (const pkg of scope) {
    checks.push(pathCheck(pkg));
    checks.push(manifestCheck(pkg));
    checks.push(authCheckFor(pkg, auth));
    if (pkg.kind === 'npm') {
      checks.push(repositoryCheck(pkg));
    }
  }

  // Artifact check runs only against matrix rows — non-cascaded packages
  // have no rows, and adding a per-row check against them is misleading.
  const artifactsRoot = join(opts.cwd, 'artifacts');
  for (const row of matrix) {
    // Vanilla npm publishes from source; no artifact dir exists.
    if (row.kind === 'npm' && row.target === 'noarch') continue;
    // If the cascaded row's package isn't in scope (unusual but possible
    // with external filters), still report — artifact issues block
    // publish regardless of `--all`.
    checks.push(artifactCheck(row, artifactsRoot));
  }

  const ok = issues.length === 0 && checks.every((c) => c.status !== 'fail');
  return { ok, checks, issues };
}

/* ----------------------------- internals ----------------------------- */

function pathCheck(pkg: Package): PreflightCheck {
  if (existsSync(pkg.path)) {
    return { package: pkg.name, kind: pkg.kind, check: 'path', status: 'ok', detail: pkg.path };
  }
  return {
    package: pkg.name,
    kind: pkg.kind,
    check: 'path',
    status: 'fail',
    detail: `pkg.path does not exist: ${pkg.path}`,
  };
}

function manifestFor(kind: Kind): string {
  switch (kind) {
    case 'crates': return 'Cargo.toml';
    case 'pypi': return 'pyproject.toml';
    case 'npm': return 'package.json';
  }
}

function manifestCheck(pkg: Package): PreflightCheck {
  const manifest = manifestFor(pkg.kind);
  const full = join(pkg.path, manifest);
  if (existsSync(full)) {
    return { package: pkg.name, kind: pkg.kind, check: 'manifest', status: 'ok', detail: manifest };
  }
  return {
    package: pkg.name,
    kind: pkg.kind,
    check: 'manifest',
    status: 'fail',
    detail: `missing ${manifest} at ${full}`,
  };
}

function authCheckFor(
  pkg: Package,
  auth: ReturnType<typeof checkAuth>,
): PreflightCheck {
  const row = auth.results.find((r) => r.package === pkg.name);
  /* v8 ignore start -- every scoped package gets a row in checkAuth */
  if (row === undefined) {
    return { package: pkg.name, kind: pkg.kind, check: 'auth', status: 'skip', detail: 'no auth row' };
  }
  /* v8 ignore stop */
  if (row.via === 'missing') {
    return {
      package: pkg.name,
      kind: pkg.kind,
      check: 'auth',
      status: 'fail',
      detail: `needs ${row.acceptedEnvVars.join(' or ')} or OIDC`,
    };
  }
  return { package: pkg.name, kind: pkg.kind, check: 'auth', status: 'ok', detail: row.via };
}

function repositoryCheck(pkg: Package): PreflightCheck {
  const pkgJsonPath = join(pkg.path, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    return {
      package: pkg.name,
      kind: pkg.kind,
      check: 'repository',
      status: 'skip',
      detail: 'no package.json',
    };
  }
  let parsed: { repository?: unknown };
  try {
    parsed = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { repository?: unknown };
  } catch (err) {
    /* v8 ignore next -- non-Error catch fallback */
    const message = err instanceof Error ? err.message : String(err);
    return {
      package: pkg.name,
      kind: pkg.kind,
      check: 'repository',
      status: 'fail',
      detail: `package.json parse error: ${message}`,
    };
  }
  if (!parsed.repository) {
    return {
      package: pkg.name,
      kind: pkg.kind,
      check: 'repository',
      status: 'fail',
      detail: '`repository` field required for `npm publish --provenance`',
    };
  }
  return { package: pkg.name, kind: pkg.kind, check: 'repository', status: 'ok' };
}

function artifactCheck(row: MatrixRow, artifactsRoot: string): PreflightCheck {
  const dir = join(artifactsRoot, row.artifact_name);
  if (existsSync(dir)) {
    return {
      package: row.name,
      kind: row.kind,
      check: 'artifact',
      status: 'ok',
      detail: row.artifact_name,
    };
  }
  return {
    package: row.name,
    kind: row.kind,
    check: 'artifact',
    status: 'fail',
    detail: `missing ${row.artifact_name}/; expected ${expectedLayout(row)}`,
  };
}
