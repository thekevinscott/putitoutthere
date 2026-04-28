/**
 * PyPI handler.
 *
 * Issue #17. Plan: §6.4, §12.2, §12.3, §13.1, §14.5, §16.1.
 *
 * Publish model: twine upload. The workflow is responsible for wiring
 * up PYPI_API_TOKEN (either from a classic secret or via a
 * trusted-publisher-backed OIDC exchange step that populates the env
 * before pilot runs). Full in-handler OIDC exchange is deferred --
 * the gh-action-pypi-publish step handles that cleanly for v0.
 *
 * Artifact discovery: scans `ctx.artifactsRoot` for directories named
 * `{pkg.name}-*` (the artifact naming contract from §12.4). Uploads
 * all `.whl` and `.tar.gz` files found under those directories. Fails
 * loud if nothing's found -- the completeness check (#13) should have
 * caught that earlier, but defense in depth.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { sanitizeArtifactName } from '../config.js';
import { ErrorCodes } from '../error-codes.js';
import type { Ctx, Handler, PublishResult } from '../types.js';
import { TransientError } from '../types.js';
import { buildSubprocessEnv, nonEmpty } from '../env.js';
import { USER_AGENT } from '../version.js';

const REGISTRY = 'https://pypi.org';

async function isPublishedImpl(
  pkg: { name: string; pypi?: string },
  version: string,
  _ctx: Ctx,
): Promise<boolean> {
  const name = pypiNameFor(pkg);
  const url = `${REGISTRY}/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'user-agent': USER_AGENT },
  });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  if (res.status >= 500) {
    throw new TransientError(`pypi.org GET ${url} returned ${res.status}`);
  }
  /* v8 ignore next -- defensive 4xx fallthrough; PyPI returns 200/404 for this endpoint */
  throw new Error(`pypi.org GET ${url} returned ${res.status}`);
}

function writeVersionImpl(
  pkg: { name?: string; path: string },
  version: string,
  ctx: Ctx,
): Promise<string[]> {
  const pyProjectPath = join(pkg.path, 'pyproject.toml');
  let original: string;
  try {
    original = readFileSync(pyProjectPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Promise.reject(new Error(`pyproject.toml not found at ${pyProjectPath}`));
    }
    /* v8 ignore next -- non-ENOENT read errors surface as-is */
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
  // Single TOML parse site: distinguishes (a) malformed TOML, (b) no [project]
  // table, (c) [project] present but without static or dynamic version.
  // The regex rewrite below only runs for case (c)-that-resolves-successfully.
  let parsed: unknown;
  try {
    parsed = parseToml(original);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Promise.reject(new Error(`pyproject.toml: failed to parse ${pyProjectPath}: ${msg}`));
  }
  const project = (parsed as { project?: { dynamic?: unknown } })?.project;
  if (!project) {
    return Promise.reject(
      new Error(
        'pyproject.toml has no [project] table -- declare [project].version or [project].dynamic = ["version"]',
      ),
    );
  }
  // Dynamic-version projects (hatch-vcs, setuptools-scm, maturin reading
  // Cargo.toml, etc) have `dynamic = [..., "version", ...]` under [project]
  // and no literal version line to rewrite. The build backend derives the
  // version itself. Per design-commitment #1 (no version computation),
  // skip the rewrite -- the consumer's build system handles propagation.
  // Surface an actionable guidance line so adopters aren't left guessing
  // how the planned version reaches the build backend. See #207.
  if (projectDynamicIncludesVersion(project)) {
    const who = pkg.name ? `pypi: ${pkg.name}` : 'pypi';
    const envSuffix = pkg.name ? scmEnvSuffix(pkg.name) : '<PKG>';
    ctx.log.info(
      [
        `${who}: detected dynamic version; skipping pyproject.toml rewrite.`,
        `  Planned version: ${version}. Pass it to the build backend via one of:`,
        `    - SETUPTOOLS_SCM_PRETEND_VERSION_FOR_${envSuffix}=${version}  (hatch-vcs / setuptools-scm)`,
        `    - Update [package].version in Cargo.toml                ${' '.repeat(Math.max(0, envSuffix.length - 12))}  (maturin reading Cargo)`,
        `  Set the env var on the build job, before \`python -m build\` / \`maturin build\` runs.`,
        `  See https://thekevinscott.github.io/putitoutthere/guide/dynamic-versions`,
      ].join('\n'),
    );
    return Promise.resolve([]);
  }
  let updated: string;
  try {
    updated = replacePyProjectVersion(original, version);
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
  if (updated === original) return Promise.resolve([]);
  writeFileSync(pyProjectPath, updated, 'utf8');
  return Promise.resolve([pyProjectPath]);
}

async function publishImpl(
  pkg: { name: string; path: string; pypi?: string },
  version: string,
  ctx: Ctx,
): Promise<PublishResult> {
  if (await isPublishedImpl(pkg, version, ctx)) {
    return { status: 'already-published' };
  }

  const files = collectArtifacts(pkg.name, ctx.artifactsRoot);
  if (files.length === 0) {
    throw new Error(
      `pypi: no artifacts found for ${pkg.name} under ${ctx.artifactsRoot ?? '(artifactsRoot unset)'}`,
    );
  }

  // Prefer OIDC trusted publishing; fall back to an explicit
  // PYPI_API_TOKEN when the GHA OIDC env is absent or the mint
  // exchange fails. Docs (docs/guide/auth.md) promise OIDC wins over
  // PYPI_API_TOKEN so a stale repo secret can't shadow the
  // short-lived path.
  const oidc = await mintOidcToken(ctx);
  const explicitToken = nonEmpty(ctx.env.PYPI_API_TOKEN) ?? nonEmpty(process.env.PYPI_API_TOKEN);
  const token = oidc.ok ? oidc.token : explicitToken;
  if (!token) {
    throw new Error(renderAuthFailure(oidc, explicitToken !== undefined));
  }
  ctx.log.info(
    oidc.ok ? 'pypi: authenticating via OIDC trusted publishing' : 'pypi: authenticating via PYPI_API_TOKEN',
  );

  try {
    execFileSync('twine', ['upload', '--non-interactive', '--disable-progress-bar', '--verbose', ...files], {
      cwd: ctx.cwd,
      // #138: minimal env. Don't forward the whole parent process.env
      // to twine.
      env: buildSubprocessEnv(ctx.env, {
        TWINE_USERNAME: '__token__',
        TWINE_PASSWORD: token,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // ENOENT = twine not on PATH. The scaffolded publish job is supposed
    // to install it (setup-python + pip install twine), but an adopter
    // running an older template or a hand-rolled workflow will hit this.
    // Give them an actionable message instead of a cryptic ENOENT. #205.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        [
          'pypi: twine not found on PATH (ENOENT).',
          'The publish job must install it before invoking piot. Add:',
          '  - uses: actions/setup-python@v5',
          "    with: { python-version: '3.12' }",
          '  - run: pip install twine',
          'See https://thekevinscott.github.io/putitoutthere/guide/runner-prerequisites',
        ].join('\n'),
        { cause: err },
      );
    }
    const stderr = (err as { stderr?: Buffer }).stderr?.toString('utf8').trim();
    const stdout = (err as { stdout?: Buffer }).stdout?.toString('utf8').trim();
    const base = err instanceof Error ? err.message : String(err);
    // Twine sometimes writes its actual failure (4xx/5xx body, render
    // diagnostic, etc.) to stdout rather than stderr; surface both so
    // adopters see the registry's response, not a bare "Command failed".
    const parts = [`twine upload failed: ${base}`];
    if (stderr) parts.push(`--- stderr ---\n${stderr}`);
    if (stdout) parts.push(`--- stdout ---\n${stdout}`);
    throw new Error(parts.join('\n'), { cause: err });
  }

  return {
    status: 'published',
    url: `${REGISTRY}/project/${pypiNameFor(pkg)}/${version}/`,
  };
}

/* ------------------------------ internals ------------------------------ */

function pypiNameFor(pkg: { name: string; pypi?: string }): string {
  return pkg.pypi ?? pkg.name;
}

/**
 * Phase 2 / Idea 3. Renders the auth-failure error with a probe summary
 * so a reader of the run log can see *why* OIDC didn't yield a token,
 * not just that it didn't. The single most-asked question in the
 * foreign-agent incident — "is OIDC even being attempted?" — is
 * answered by the first line of the probe section.
 *
 * The error string is the *only* surface a downstream agent reading
 * GH's public annotation strip can rely on; the warn lines emitted
 * earlier in the run are auth-gated. Make it self-contained.
 */
function renderAuthFailure(
  oidc: OidcMintResult,
  pypiTokenSet: boolean,
): string {
  // Each probe row is `<probe>: <result>`. Short, parseable, and stable
  // enough that a foreign agent can fingerprint it.
  const probes: string[] = [];
  if (!oidc.ok && oidc.reason === 'env-missing') {
    probes.push('  - OIDC env vars (ACTIONS_ID_TOKEN_REQUEST_*): absent');
    probes.push('  - OIDC id-token request: skipped');
    probes.push('  - OIDC mint exchange: skipped');
  } else if (!oidc.ok && oidc.reason === 'id-token-http') {
    probes.push('  - OIDC env vars (ACTIONS_ID_TOKEN_REQUEST_*): present');
    probes.push(`  - OIDC id-token request: failed (${oidc.detail ?? 'unknown'})`);
    probes.push('  - OIDC mint exchange: skipped');
  } else if (!oidc.ok && oidc.reason === 'id-token-empty') {
    probes.push('  - OIDC env vars (ACTIONS_ID_TOKEN_REQUEST_*): present');
    probes.push('  - OIDC id-token request: ok (response missing `value`)');
    probes.push('  - OIDC mint exchange: skipped');
  } else if (!oidc.ok && oidc.reason === 'mint-rejected') {
    probes.push('  - OIDC env vars (ACTIONS_ID_TOKEN_REQUEST_*): present');
    probes.push('  - OIDC id-token request: ok');
    probes.push(`  - OIDC mint exchange: rejected (${oidc.detail ?? 'unknown'})`);
  }
  /* v8 ignore next 4 -- oidc.ok=true is unreachable here (caller only
     enters this branch when no token resolved), but TS can't prove it */
  if (oidc.ok) {
    probes.push('  - OIDC: succeeded (caller bug — should not have reached here)');
  }
  probes.push(`  - PYPI_API_TOKEN: ${pypiTokenSet ? 'set' : 'unset'}`);

  const code = ErrorCodes.AUTH_NO_TOKEN;
  return [
    `pypi: no auth available [${code}]`,
    '',
    'Probe results:',
    ...probes,
    '',
    'Either:',
    '  - set PYPI_API_TOKEN (classic API token), or',
    '  - enable trusted publishing: add `permissions.id-token: write` to the job and register a pending publisher on pypi.org.',
    // Code-deep-linked URL so the docs site can render code-specific
    // guidance. Foreign agents grep on the code; the URL gives the
    // reader a one-click jump.
    `See https://thekevinscott.github.io/putitoutthere/guide/auth?code=${code} for setup.`,
  ].join('\n');
}

/**
 * Outcome of an OIDC trusted-publishing exchange. Every non-success
 * branch carries a machine-readable `reason` so callers (and the
 * failure renderer in #verbose.ts) can distinguish:
 *
 *  - `env-missing`     ACTIONS_ID_TOKEN_REQUEST_{URL,TOKEN} not present
 *                      in the runner env. Usually means `id-token: write`
 *                      wasn't declared on the job.
 *  - `id-token-http`   The runner's id-token endpoint returned non-2xx.
 *                      `detail` carries the status. Often transient.
 *  - `id-token-empty`  2xx response but `value` field absent. Pathological
 *                      runner state; not retryable.
 *  - `mint-rejected`   PyPI returned non-2xx on the mint exchange.
 *                      `detail` carries `<status>: <body excerpt>`. The
 *                      typical `invalid-publisher` 422 lands here with
 *                      the expected `job_workflow_ref` list visible to
 *                      the caller (used by Phase 2/Idea 3 to dump the
 *                      probe result into the auth-failure error).
 *
 * Replaces the prior `string | null` shape. Phase 1 / Idea 1.
 */
export type OidcMintResult =
  | { ok: true; token: string }
  | {
      ok: false;
      reason: 'env-missing' | 'id-token-http' | 'id-token-empty' | 'mint-rejected';
      detail?: string;
    };

/**
 * Trusted-publishing OIDC exchange. Returns a tagged result so every
 * failure branch is named — see `OidcMintResult` for the vocabulary.
 * Exported for direct testing of each skip path.
 */
export async function mintOidcToken(ctx: Ctx): Promise<OidcMintResult> {
  const reqUrl =
    nonEmpty(ctx.env.ACTIONS_ID_TOKEN_REQUEST_URL) ??
    nonEmpty(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  const reqToken =
    nonEmpty(ctx.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) ??
    nonEmpty(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  if (!reqUrl || !reqToken) {
    // Was previously a silent `return null`. Foreign agents debugging
    // the foreign-agent incident had no way to tell from logs that
    // OIDC was even tried; the reason-tagged warn closes that gap.
    ctx.log.warn(
      'pypi: OIDC skipped (reason=env-missing): ACTIONS_ID_TOKEN_REQUEST_URL or ACTIONS_ID_TOKEN_REQUEST_TOKEN absent (id-token: write not declared on the job?)',
    );
    return { ok: false, reason: 'env-missing' };
  }

  // Breadcrumb on entry only — by this point we have the env to try.
  ctx.log.info('pypi: attempting OIDC trusted publishing (audience=pypi)');

  const idTokenRes = await fetch(`${reqUrl}&audience=pypi`, {
    headers: { authorization: `bearer ${reqToken}` },
  });
  if (!idTokenRes.ok) {
    ctx.log.warn(
      `pypi: OIDC skipped (reason=id-token-http): runner id-token endpoint returned ${idTokenRes.status}`,
    );
    return { ok: false, reason: 'id-token-http', detail: `status ${idTokenRes.status}` };
  }
  const idTokenJson = (await idTokenRes.json()) as { value?: string };
  const idToken = idTokenJson.value;
  if (!idToken) {
    ctx.log.warn(
      'pypi: OIDC skipped (reason=id-token-empty): id-token response missing `value`',
    );
    return { ok: false, reason: 'id-token-empty' };
  }

  const mintRes = await fetch(`${REGISTRY}/_/oidc/mint-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: idToken }),
  });
  if (!mintRes.ok) {
    const body = await mintRes.text();
    const excerpt = body.slice(0, 400);
    // Body excerpt is the diagnostic — typically `invalid-publisher`
    // with the expected `job_workflow_ref` list. Phase 2 / Idea 3
    // surfaces this same detail into the user-facing error too.
    ctx.log.warn(
      `pypi: OIDC skipped (reason=mint-rejected): registry returned ${mintRes.status}: ${excerpt}`,
    );
    return {
      ok: false,
      reason: 'mint-rejected',
      detail: `status ${mintRes.status}: ${excerpt}`,
    };
  }
  const mintJson = (await mintRes.json()) as { token?: string };
  if (!mintJson.token) {
    // Pathological — 2xx with no token field. Map to mint-rejected so
    // callers handle it the same way as a 4xx (auth path is busted).
    ctx.log.warn(
      'pypi: OIDC skipped (reason=mint-rejected): mint response 2xx but missing `token` field',
    );
    return { ok: false, reason: 'mint-rejected', detail: 'mint response missing `token`' };
  }
  return { ok: true, token: mintJson.token };
}

/**
 * Rewrites the first `version = "x.y.z"` inside the `[project]` table.
 *
 * Precondition: the caller has already confirmed a `[project]` table exists
 * and does not declare `dynamic = ["version"]`. Throws when no literal
 * `version = "..."` line can be located inside `[project]`.
 */
export function replacePyProjectVersion(source: string, version: string): string {
  const re = /(\[project\][\s\S]*?)(^\s*version\s*=\s*")([^"]*)(")/m;
  const m = re.exec(source);
  if (!m) {
    throw new Error(
      'pyproject.toml: [project] is present but declares neither a static version nor dynamic = ["version"]',
    );
  }
  const [, pre, prefix, old, suffix] = m as unknown as [string, string, string, string, string];
  if (old === version) return source;
  const start = m.index + pre.length;
  const end = start + prefix.length + old.length + suffix.length;
  return source.slice(0, start) + prefix + version + suffix + source.slice(end);
}

/**
 * Returns true when a parsed `[project].dynamic` is an array containing
 * `"version"`. Used to detect hatch-vcs / setuptools-scm / maturin setups
 * where the build backend computes the version and no literal
 * `version = "..."` line exists to rewrite.
 */
function projectDynamicIncludesVersion(project: { dynamic?: unknown }): boolean {
  const { dynamic } = project;
  return Array.isArray(dynamic) && dynamic.includes('version');
}

/**
 * `SETUPTOOLS_SCM_PRETEND_VERSION_FOR_<SUFFIX>` name suffix derived from
 * a package name per PEP 503's canonical normalisation. Uppercase,
 * dashes + dots + underscores all collapse to a single underscore.
 */
export function scmEnvSuffix(pkgName: string): string {
  return pkgName.replace(/[-._]+/g, '_').toUpperCase();
}

/**
 * Collects `.whl` and `.tar.gz` files across every artifact subdir whose
 * name starts with the package's pilot name. Matches the artifact naming
 * contract from §12.4: `{name}-wheel-{target}` and `{name}-sdist`.
 */
function collectArtifacts(pkgName: string, artifactsRoot: string | undefined): string[] {
  if (!artifactsRoot || !existsSync(artifactsRoot)) return [];
  // #237: encode pkg.name so slash-containing names (e.g. `py/foo` →
  // `py__foo`) line up with the on-disk directory the planner emitted.
  // Match exactly the two artifact-name shapes the planner emits per
  // §12.4: `{name}-sdist` (single dir) and `{name}-wheel-{target}` (one
  // dir per wheel target). A bare prefix match would also pick up
  // sibling packages whose names extend the same prefix
  // (`foo-extras-sdist` matched as if it were `foo`'s sdist) — the
  // tighter shape mirrors the documented contract.
  const base = sanitizeArtifactName(pkgName);
  const sdistDir = `${base}-sdist`;
  const wheelPrefix = `${base}-wheel-`;
  const out: string[] = [];
  for (const entry of readdirSync(artifactsRoot)) {
    if (entry !== sdistDir && !entry.startsWith(wheelPrefix)) continue;
    const sub = join(artifactsRoot, entry);
    /* v8 ignore next -- fs entries shouldn't vanish between readdir and stat */
    if (!statSync(sub).isDirectory()) continue;
    // #237: walk recursively so we tolerate any layout inside the
    // artifact directory. upload-artifact's behavior differs per
    // path-input shape (directory vs glob), so a flat `readdir` here
    // would miss files that landed in a workspace-relative subdir.
    for (const file of walkFiles(sub)) {
      if (file.endsWith('.whl') || file.endsWith('.tar.gz')) {
        out.push(file);
      }
    }
  }
  return out;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}

export const pypi: Handler = {
  kind: 'pypi',
  isPublished: isPublishedImpl,
  writeVersion: writeVersionImpl,
  publish: publishImpl,
};
