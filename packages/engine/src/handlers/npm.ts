/**
 * npm handler — vanilla mode.
 *
 * Issue #18. Plan: §7.4, §12.2 (vanilla), §13.1, §14.5, §16.1.
 *
 * The matrix-using modes (napi, bundled-cli) layer on top of this in
 * #19; they share isPublished and writeVersion, and add a platform-
 * package orchestration step before the main publish.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizeTarget, TransientError, type Ctx, type Handler, type PublishResult, type TargetEntry, type TrustPosture } from '../types.js';
import { execCapture } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';
import { detectIndent } from './detect-indent.js';
import {
  looksLikePublishOverRace,
  normalizeBuild,
  publishPlatforms,
  type NpmBuildField,
  type PlatformPkg,
} from './npm-platform.js';
import { matchTlogDuplicate } from './match-tlog-duplicate.js';
import { buildSubprocessEnv, nonEmpty } from '../env.js';
import { ErrorCodes } from '../error-codes.js';
import { toError } from '../to-error.js';
import { USER_AGENT } from '../version.js';

type NpmPkg = {
  name: string;
  path: string;
  npm?: string;
  access?: 'public' | 'restricted';
  tag?: string;
  // #dirsql: `build` accepts a single mode string ("napi" / "bundled-cli")
  // for backward compat, OR an array of entries — strings or
  // `{ mode, name }` objects — to publish multiple platform-package
  // families per main package. See src/handlers/npm-platform.ts.
  build?: NpmBuildField;
  // #159: `targets` entries can be bare triples or `{ triple, runner }`
  // objects. Only the triple matters at publish time; the `runner`
  // override is a CI-matrix concern consumed by the planner.
  targets?: readonly TargetEntry[];
};

function npmNameFor(pkg: NpmPkg): string {
  return pkg.npm ?? pkg.name;
}

async function isPublishedImpl(pkg: NpmPkg, version: string, ctx: Ctx): Promise<boolean> {
  const name = npmNameFor(pkg);
  try {
    await execCapture('npm', ['view', `${name}@${version}`, 'version'], {
      cwd: ctx.cwd,
    });
    return true;
  } catch {
    // `npm view` exits non-zero when the version doesn't exist.
    // We treat every non-zero as "not published"; the subsequent
    // publish step will surface real auth/network errors there.
    return false;
  }
}

async function writeVersionImpl(pkg: NpmPkg, version: string, _ctx: Ctx): Promise<string[]> {
  const p = join(pkg.path, 'package.json');
  let original: string;
  try {
    original = await readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`package.json not found at ${p}`, { cause: err });
    }
    throw toError(err);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(original) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `package.json JSON parse error: ${toError(err).message}`,
      { cause: err },
    );
  }
  if (parsed.version === version) {return [];}
  parsed.version = version;
  // Preserve the existing indentation shape (2-space default if we
  // can't detect) and the trailing newline when present.
  const indent = detectIndent(original);
  const trailing = original.endsWith('\n') ? '\n' : '';
  await writeFile(p, JSON.stringify(parsed, null, indent) + trailing, 'utf8');
  return [p];
}

async function publishImpl(pkg: NpmPkg, version: string, ctx: Ctx): Promise<PublishResult> {
  if (await isPublishedImpl(pkg, version, ctx)) {
    return { status: 'already-published' };
  }

  // napi / bundled-cli: publish platform packages first, then rewrite
  // the main package.json to add optionalDependencies, then fall through
  // to the normal main-package publish path below. §13.7.
  const buildEntries = normalizeBuild(pkg.build);
  if (buildEntries.length > 0 && pkg.targets !== undefined && pkg.targets.length > 0) {
    const platformPkg: PlatformPkg = {
      name: pkg.name,
      path: pkg.path,
      npm: pkg.npm,
      access: pkg.access,
      tag: pkg.tag,
      build: buildEntries,
      // Platform publishing only cares about the triple — the `runner`
      // override is a planner/CI concern. Normalize away the union here
      // so npm-platform.ts keeps its `readonly string[]` contract.
      targets: pkg.targets.map((t) => normalizeTarget(t).triple),
    };
    await publishPlatforms(platformPkg, version, ctx);
  }

  // Internal e2e seam: PIOT_NPM_REGISTRY routes publish at a non-default
  // registry (Verdaccio in the first-publish e2e variant; #304). Not a
  // consumer-facing affordance and not documented in README. Auth at the
  // override registry flows through `.npmrc` (`_authToken` etc.) which
  // the e2e workflow writes alongside the fixture; this handler only
  // needs to (a) tell npm which registry to talk to, and (b) suppress
  // the public-npm-specific provenance + bootstrap-hint logic that
  // assumes registry.npmjs.org semantics.
  const registryOverride = nonEmpty(ctx.env.PIOT_NPM_REGISTRY) ?? nonEmpty(process.env.PIOT_NPM_REGISTRY);

  const hasOidc =
    !registryOverride &&
    Boolean(
      nonEmpty(ctx.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) ??
        nonEmpty(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN),
    );

  // npm provenance requires a non-empty `repository` field in
  // package.json that matches the git remote. The primary check is
  // `requireProvenanceMetadata` in src/preflight.ts (#280), which
  // runs before any runner work. This inline assertion is a
  // defensive backstop for direct handler calls that bypass the
  // publish pipeline.
  if (hasOidc) {
    await assertRepositoryField(pkg.path);
  }

  const access = pkg.access ?? 'public';
  const args: string[] = ['publish', `--access=${access}`];
  if (pkg.tag) {args.push(`--tag=${pkg.tag}`);}
  if (hasOidc) {args.push('--provenance');}
  if (registryOverride) {args.push(`--registry=${registryOverride}`);}

  try {
    await execCapture('npm', args, {
      cwd: pkg.path,
      // #138: minimal env. Avoid leaking the whole parent process.env
      // (and any unrelated step secrets) to npm.
      env: buildSubprocessEnv(ctx.env),
    });
  } catch (err) {
    const stderr = err instanceof ExecError ? err.stderr.trim() : undefined;
    const base = err instanceof Error ? err.message : String(err);
    const name = npmNameFor(pkg);
    // npm CLI's retry-on-transient-network-error: a successful PUT that
    // came back flaky (timeout / 502 / reset) gets retried, the second
    // PUT lands on a registry that already has the version, npm exits
    // E403 "cannot publish over the previously published versions". The
    // first attempt actually succeeded — treat as already-published.
    if (looksLikePublishOverRace(stderr)) {
      return {
        status: 'already-published',
        url: `https://www.npmjs.com/package/${name}/v/${version}`,
      };
    }
    // Attestation edition of the publish-over race: npm's retry re-submits
    // an identical --provenance attestation and Sigstore/Rekor rejects the
    // duplicate (TLOG_CREATE_ENTRY_ERROR, 409). A 409 alone doesn't prove
    // the upload landed, so re-probe the registry: present => the publish
    // actually succeeded; absent => a genuine partial publish that a fresh
    // run (new attestation) resolves.
    const tlogStderr = matchTlogDuplicate(stderr);
    if (tlogStderr !== null) {
      if (await isPublishedImpl(pkg, version, ctx)) {
        return {
          status: 'already-published',
          url: `https://www.npmjs.com/package/${name}/v/${version}`,
        };
      }
      throw new Error(
        `npm publish failed: Sigstore transparency-log dedupe ` +
          `(TLOG_CREATE_ENTRY_ERROR) and ${name}@${version} is not on the ` +
          `registry — npm's provenance retry re-submitted an identical ` +
          `attestation. Re-run the release to mint a fresh attestation.` +
          `\n${tlogStderr}`,
        { cause: err },
      );
    }
    // npm trusted publishing (OIDC) requires the package to already
    // exist on the registry; the first-ever publish must go through a
    // token. Detect that exact shape — auth failure + OIDC in play +
    // package not on the registry — and surface a bootstrap hint
    // before the generic stderr dump.
    if (hasOidc && looksLikeAuthFailure(stderr)) {
      if (await isBootstrapPublish(name)) {
        throw new Error(
          [
            `npm publish: package "${name}" does not exist on registry.npmjs.org yet.`,
            'npm trusted publishing requires the package to exist first.',
            'Bootstrap by setting NODE_AUTH_TOKEN for the first publish; you can migrate to trusted publishing afterwards.',
          ].join('\n'),
          { cause: err },
        );
      }
    }
    throw new Error(`npm publish failed${stderr ? `:\n${stderr}` : `: ${base}`}`, { cause: err });
  }

  return {
    status: 'published',
    url: registryOverride
      ? `${registryOverride.replace(/\/$/, '')}/${npmNameFor(pkg)}/-/${version}`
      : `https://www.npmjs.com/package/${npmNameFor(pkg)}/v/${version}`,
  };
}

/* ------------------------------ internals ------------------------------ */

async function assertRepositoryField(path: string): Promise<void> {
  const pkgJsonPath = join(path, 'package.json');
  const raw = await readFile(pkgJsonPath, 'utf8');
  const pkg = JSON.parse(raw) as { repository?: unknown };
  const repository = pkg.repository;
  // Accept either the canonical object form (`{ type, url, … }`) or
  // the legacy single-string form. Both shapes must carry a non-empty
  // URL after trimming. `!pkg.repository` would pass `{}` and
  // `{ type: 'git' }` since both are truthy — that's the bug #280
  // is closing.
  let ok = false;
  if (typeof repository === 'string') {
    ok = repository.trim().length > 0;
  } else if (repository !== null && typeof repository === 'object') {
    const url = (repository as { url?: unknown }).url;
    ok = typeof url === 'string' && url.trim().length > 0;
  }
  if (!ok) {
    throw new Error(
      `[${ErrorCodes.NPM_MISSING_REPOSITORY}] npm publish --provenance requires a non-empty \`repository\` field in ${pkgJsonPath}. ` +
        'See https://github.com/thekevinscott/putitoutthere#kind--npm.',
    );
  }
}

/** Heuristic match on npm's auth-related stderr shapes. */
function looksLikeAuthFailure(stderr: string | undefined): boolean {
  if (!stderr) {return false;}
  return /\b(E401|E403|ENEEDAUTH|EAUTH|need auth|not authori[sz]ed|unauthorized|forbidden)\b/i.test(
    stderr,
  );
}

/**
 * Returns true when the package does not yet exist on the registry
 * (any 404-equivalent from the packument endpoint). Non-404 responses
 * — including network failures and timeouts — return false so we
 * don't misclassify transient errors as the bootstrap case.
 *
 * The fetch is bounded by a 5s AbortSignal.timeout (#142). The hint is
 * advisory: a slow or unreachable registry should fall through to
 * "not a bootstrap publish" rather than hanging the action.
 */
export async function isBootstrapPublish(name: string): Promise<boolean> {
  try {
    // The npm registry expects scoped packages as `@scope%2Fname`: the
    // `@` prefix stays literal, `/` stays percent-encoded. Unscoped
    // names have no `@` at all. `replaceAll` keeps the transform safe
    // against pathological input even though encodeURIComponent can
    // only produce `%40` at the start of a valid npm name.
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name).replaceAll('%40', '@')}`,
      {
        method: 'GET',
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      },
    );
    return res.status === 404;
  } catch {
    // Network failure, timeout, DNS error — treat as "not a bootstrap"
    // so the caller falls through to the generic auth-error message
    // rather than hanging or surfacing a misleading hint.
    return false;
  }
}

/**
 * Latest published version of the package, or null when it has never
 * been published (404). GET registry.npmjs.org/{name} (the packument) →
 * `dist-tags.latest`. Reuses `npmNameFor` and the same scoped-name
 * encoding as the bootstrap probe, so this read resolves the npm name
 * exactly as `isPublished` / `publish` do. Any non-200/404 is surfaced
 * as a TransientError; the read-only caller renders that as
 * "unreachable". Unlike `isPublished` (which shells out to `npm view`),
 * this uses a plain unauthenticated GET — `status` needs no npm CLI.
 */
async function latestVersionImpl(pkg: NpmPkg, _ctx: Ctx): Promise<string | null> {
  const name = npmNameFor(pkg);
  const url = `https://registry.npmjs.org/${encodeURIComponent(name).replaceAll('%40', '@')}`;
  const res = await fetch(url, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  if (res.status === 200) {
    const body = (await res.json()) as { 'dist-tags'?: { latest?: string } };
    return body['dist-tags']?.latest ?? null;
  }
  if (res.status === 404) {return null;}
  throw new TransientError(`registry.npmjs.org GET ${url} returned ${res.status}`);
}

/**
 * Trust posture for a published npm version (#414). A `--provenance`
 * publish (the OIDC trusted-publisher path) writes a provenance
 * attestation; the public attestations endpoint returns 200 for it and
 * 404 when none exists (a plain token publish).
 */
async function trustPostureImpl(pkg: NpmPkg, version: string, _ctx: Ctx): Promise<TrustPosture> {
  const name = npmNameFor(pkg);
  const url = `https://registry.npmjs.org/-/npm/v1/attestations/${name}@${version}`;
  const res = await fetch(url, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  if (res.status === 200) {return 'oidc';}
  if (res.status === 404) {return 'token';}
  throw new TransientError(`registry.npmjs.org GET ${url} returned ${res.status}`);
}

export const npm: Handler = {
  kind: 'npm',
  isPublished: isPublishedImpl,
  latestVersion: latestVersionImpl,
  trustPosture: trustPostureImpl,
  writeVersion: writeVersionImpl,
  publish: publishImpl,
};
