/**
 * npm handler — vanilla mode. Issue #18. Plan: §7.4, §12.2 (vanilla), §13.1,
 * §14.5, §16.1. The matrix modes (napi, bundled-cli, #19) share `isPublished`
 * and `writeVersion` and add platform-package orchestration before this.
 */

import { normalizeTarget, TransientError, type Ctx, type Handler, type PlatformPublishSummary, type PublishResult, type TrustPosture } from '../types.js';
import { execCapture } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';
import { assertRepositoryField } from './assert-repository-field.js';
import { isBootstrapPublish } from './is-bootstrap-publish.js';
import {
  looksLikePublishOverRace,
  normalizeBuild,
  publishPlatforms,
  type PlatformPkg,
} from './npm-platform.js';
import { matchNpmNameTooSimilar } from './match-npm-name-too-similar.js';
import { matchTlogDuplicate } from './match-tlog-duplicate.js';
import { npmIsPublished } from './npm-is-published.js';
import { npmLatestVersion } from './npm-latest-version.js';
import { npmNameFor, type NpmPkg } from './npm-name-for.js';
import { npmWriteVersion } from './npm-write-version.js';
import { buildSubprocessEnv, nonEmpty } from '../env.js';
import { ErrorCodes } from '../error-codes.js';
import { USER_AGENT } from '../version.js';

async function publishImpl(pkg: NpmPkg, version: string, ctx: Ctx): Promise<PublishResult> {
  if (await npmIsPublished(pkg, version, ctx)) {
    return { status: 'already-published' };
  }

  // napi / bundled-cli: publish platform packages first, then rewrite the main
  // package.json's optionalDependencies, then fall through to the main publish
  // below (§13.7). `platforms` carries what `publishPlatforms` published vs.
  // found already live (#625); it stays undefined for a family-less package.
  let platforms: PlatformPublishSummary | undefined;
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
    platforms = await publishPlatforms(platformPkg, version, ctx);
    // Emitted here rather than only in the final report so a live run
    // log shows the family as it lands, not just at the end.
    ctx.log.info(
      `npm: ${npmNameFor(pkg)}@${version} platform packages: ` +
        `${platforms.published.length} published, ` +
        `${platforms.skipped.length} already published`,
      { published: platforms.published, skipped: platforms.skipped },
    );
  }

  // Attach the family summary to whichever outcome this publish reaches.
  // Every return below this point is downstream of the platform publish,
  // so all of them carry it; the already-published early return above is
  // not, and correctly reports no family (nothing was touched).
  const withPlatforms = (result: PublishResult): PublishResult =>
    platforms === undefined ? result : { ...result, platforms };

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
      return withPlatforms({
        status: 'already-published',
        url: `https://www.npmjs.com/package/${name}/v/${version}`,
      });
    }
    // Attestation edition of the publish-over race: npm's retry re-submits
    // an identical --provenance attestation and Sigstore/Rekor rejects the
    // duplicate (TLOG_CREATE_ENTRY_ERROR, 409). A 409 alone doesn't prove
    // the upload landed, so re-probe the registry: present => the publish
    // actually succeeded; absent => a genuine partial publish that a fresh
    // run (new attestation) resolves.
    const tlogStderr = matchTlogDuplicate(stderr);
    if (tlogStderr !== null) {
      if (await npmIsPublished(pkg, version, ctx)) {
        return withPlatforms({
          status: 'already-published',
          url: `https://www.npmjs.com/package/${name}/v/${version}`,
        });
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
    // npm's moniker rule: the registry compares names with punctuation
    // stripped and case folded, so an existing `will-run` makes a new
    // `willrun` unregistrable (scoped names are exempt). This must be
    // checked BEFORE the bootstrap hint below, because on a first publish
    // it wears the hint's exact shape — auth-shaped stderr, OIDC in play,
    // package genuinely absent from the registry — and the hint is a lie
    // here: no token can create this name. #617.
    //
    // Gated on neither OIDC nor the registry override: an unregistrable
    // name is a naming problem on any auth path and any registry that
    // enforces the rule.
    const tooSimilarStderr = matchNpmNameTooSimilar(stderr);
    if (tooSimilarStderr !== null) {
      throw new Error(
        [
          `[${ErrorCodes.NPM_NAME_TOO_SIMILAR}] npm refused to create "${name}": the registry rejected the name as too similar to a package that already exists.`,
          "This is a naming problem, not an auth problem — npm's moniker rule blocks a new name that differs from an existing one only by punctuation (`-`, `_`, `.`) or letter case, so no token and no trusted publisher can create it.",
          `Fix: rename the package, or scope it (\`@your-scope/${name}\`) — scoped names are exempt — then update \`[[package]].name\` (or the \`npm\` override) in putitoutthere.toml and the \`name\` in package.json to match.`,
          tooSimilarStderr,
        ].join('\n'),
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
            // Keep the evidence. The hint reads the registry's *absence*
            // of the package, not its reason for refusing, so it is a
            // guess — an accurate one for the shape it was written for,
            // and wrong for anything else that 404s the same way. Without
            // npm's own words attached, a wrong guess is unfalsifiable:
            // #617 cost four runs and two fresh tokens precisely because
            // this Error replaced the stderr that said why.
            stderr,
          ].join('\n'),
          { cause: err },
        );
      }
    }
    throw new Error(`npm publish failed${stderr ? `:\n${stderr}` : `: ${base}`}`, { cause: err });
  }

  return withPlatforms({
    status: 'published',
    url: registryOverride
      ? `${registryOverride.replace(/\/$/, '')}/${npmNameFor(pkg)}/-/${version}`
      : `https://www.npmjs.com/package/${npmNameFor(pkg)}/v/${version}`,
  });
}

/* ------------------------------ internals ------------------------------ */

/**
 * Heuristic match on npm's auth-related stderr shapes. `E404` belongs here:
 * npm answers an unauthorized publish with not-found, not 401/403, since
 * confirming a package exists but is unwritable is itself disclosure. The
 * ambiguity is the caller's to resolve, not this predicate's (#598).
 */
function looksLikeAuthFailure(stderr: string | undefined): stderr is string {
  if (!stderr) {return false;}
  return /\b(E401|E403|E404|ENEEDAUTH|EAUTH|need auth|not authori[sz]ed|unauthorized|forbidden)\b/i.test(
    stderr,
  );
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
  isPublished: npmIsPublished,
  latestVersion: npmLatestVersion,
  trustPosture: trustPostureImpl,
  writeVersion: npmWriteVersion,
  publish: publishImpl,
};
