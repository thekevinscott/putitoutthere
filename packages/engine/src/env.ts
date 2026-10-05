/**
 * Shared env-var helpers. Handlers read auth/OIDC vars out of both `ctx.env`
 * and `process.env`, where `a ?? b` breaks on `a === ''` — nullish coalescing
 * only falls through on null/undefined, and CI harnesses commonly forward
 * optional env as `FOO: process.env.FOO ?? ''`. `nonEmpty()` normalizes that.
 */

export function nonEmpty(v: string | undefined): string | undefined {
  return v && v.length > 0 ? v : undefined;
}

/**
 * Env-var names passed through from the parent `process.env` to every
 * subprocess (cargo / twine / npm / git). Deliberately minimal (#138): the
 * default `{ ...process.env, ...ctx.env }` pattern leaks every unrelated
 * secret on the runner. Secrets arrive only via `ctx.env` passthrough.
 */
const DEFAULT_ENV_PASSTHROUGH: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TEMP',
  'TMP',
  // Windows basics
  'USERPROFILE',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'WINDIR',
  'ComSpec',
  'COMSPEC',
  'APPDATA',
  'LOCALAPPDATA',
  'PATHEXT',
  // Tool-config discovery (non-secret): cargo/rustup/npm look here
  // to find their own config.
  'CARGO_HOME',
  'RUSTUP_HOME',
  'npm_config_userconfig',
  'NPM_CONFIG_USERCONFIG',
];

/**
 * Build a minimal env for a subprocess spawn: the `DEFAULT_ENV_PASSTHROUGH`
 * subset of `process.env`, then `ctxEnv` (workflow-declared passthroughs,
 * where tokens and OIDC vars live), then handler `extras`. Later layers win;
 * undefined values are dropped so a handler can explicitly omit a var. #138.
 */
export function buildSubprocessEnv(
  ctxEnv: Record<string, string | undefined> = {},
  extras: Record<string, string | undefined> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of DEFAULT_ENV_PASSTHROUGH) {
    const v = process.env[name];
    if (typeof v === 'string') {out[name] = v;}
  }
  for (const [k, v] of Object.entries(ctxEnv)) {
    if (typeof v === 'string') {out[k] = v;}
  }
  for (const [k, v] of Object.entries(extras)) {
    if (typeof v === 'string') {out[k] = v;}
  }
  return out;
}
