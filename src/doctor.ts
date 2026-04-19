/**
 * `putitoutthere doctor` — pre-flight validator.
 *
 * Validates: config parses; every package has a resolvable kind; every
 * package has usable credentials (OIDC or per-kind token). Returns a
 * structured report rather than throwing so the CLI can render it as
 * a table.
 *
 * Issue #23. Plan: §21.1, §16.4.7.
 */

import { loadConfig, type Package } from './config.js';
import { checkAuth, type AuthResult } from './preflight.js';

export interface DoctorOptions {
  cwd: string;
  configPath?: string;
}

export interface DoctorReport {
  ok: boolean;
  issues: string[];
  packages: Array<{
    name: string;
    kind: string;
    auth: AuthResult['via'];
  }>;
}

export function doctor(opts: DoctorOptions): Promise<DoctorReport> {
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
          `auth: ${pkg.name} (${pkg.kind}) needs ${row?.envVar ?? '<env-var>'} or OIDC`,
        );
      }
    }
  }

  return Promise.resolve({
    ok: issues.length === 0,
    issues,
    packages,
  });
}
