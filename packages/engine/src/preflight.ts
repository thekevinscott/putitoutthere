/**
 * Pre-flight auth check, run before any publish side effect (#14; plan §16.3).
 * Each handler accepts OIDC (detected via `ACTIONS_ID_TOKEN_REQUEST_TOKEN`)
 * or a specific long-lived env var.
 */

import type { Package } from './config.js';
import type { Kind } from './types.js';

// Per-kind accepted env var names, primary first. `checkAuth` scans left
// to right and reports the first that has a non-empty value. npm takes
// two names because ecosystems have split on the convention:
//   - `NODE_AUTH_TOKEN` — `actions/setup-node`'s `.npmrc` template.
//   - `NPM_TOKEN` — widely used at the workflow step level and by
//     community tooling (semantic-release, lerna, etc.).
// Accepting both keeps the pre-flight accurate for adopters who expose
// their secret under either name. #95.
const TOKEN_ENV: Record<Kind, readonly string[]> = {
  crates: ['CARGO_REGISTRY_TOKEN'],
  pypi: ['PYPI_API_TOKEN'],
  npm: ['NODE_AUTH_TOKEN', 'NPM_TOKEN'],
};

const OIDC_ENV = 'ACTIONS_ID_TOKEN_REQUEST_TOKEN';

export interface AuthResult {
  package: string;
  kind: Kind;
  via: 'oidc' | 'token' | 'missing';
  /** The matched env var when via=token; the primary otherwise. */
  envVar: string;
  /** Every env var name the handler will accept for this kind. */
  acceptedEnvVars: readonly string[];
}

export interface AuthStatus {
  ok: boolean;
  results: AuthResult[];
}

export function checkAuth(packages: readonly Package[]): AuthStatus {
  const hasOidc = nonEmpty(process.env[OIDC_ENV]);
  const results: AuthResult[] = packages.map((p) => {
    const acceptedEnvVars = TOKEN_ENV[p.kind];
    const primary = acceptedEnvVars[0] as string;
    if (hasOidc) {
      return { package: p.name, kind: p.kind, via: 'oidc', envVar: primary, acceptedEnvVars };
    }
    const matched = acceptedEnvVars.find((name) => nonEmpty(process.env[name]));
    if (matched !== undefined) {
      return { package: p.name, kind: p.kind, via: 'token', envVar: matched, acceptedEnvVars };
    }
    return { package: p.name, kind: p.kind, via: 'missing', envVar: primary, acceptedEnvVars };
  });
  const ok = results.every((r) => r.via !== 'missing');
  return { ok, results };
}

function nonEmpty(v: string | undefined): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}
