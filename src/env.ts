/**
 * Shared env-var helpers.
 *
 * Handlers read auth/OIDC env vars out of both `ctx.env` (workflow-set)
 * and `process.env` (runner-set). The natural `a ?? b` pattern breaks
 * when `a === ''`: nullish coalescing only falls through on
 * null/undefined, so `Boolean('' ?? 'real-token')` is `false`. CI
 * harnesses often set `FOO: process.env.FOO ?? ''` to forward optional
 * env, which makes empty strings a common runtime reality.
 *
 * `nonEmpty()` normalizes that by treating empty strings as unset, so
 * the coalesce falls through correctly.
 */

export function nonEmpty(v: string | undefined): string | undefined {
  return v && v.length > 0 ? v : undefined;
}
