/**
 * crates.io handler (#16; plan §7.4, §13.1, §14.5, §16.1). `--allow-dirty`
 * is required by the writeVersion-then-publish model (#135), so
 * `scanDirtyOutsideManifest` reinstates a narrowed dirty-check. stderr is
 * elided mid-message (#651): GitHub cuts a log line at 64KB from the *front*.
 */

import { join } from 'node:path';

import type { Ctx, Handler, PublishResult } from '../types.js';
import { ErrorCodes } from '../error-codes.js';
import { buildSubprocessEnv, nonEmpty } from '../env.js';
import { execCapture } from '../utils/exec-capture.js';
import { elideMiddle } from '../utils/elide-middle.js';
import { scanDirtyOutsideManifest } from './scan-dirty-outside-manifest.js';
import { ExecError } from '../utils/exec-error.js';
import { matchFirstPublishTpRejection } from './match-first-publish-tp-rejection.js';
import { crateNameFor, cratesRegistry } from './crate-name-for.js';
import { cratesIsPublished } from './crates-is-published.js';
import { cratesLatestVersion } from './crates-latest-version.js';
import { cratesTrustPosture } from './crates-trust-posture.js';
import { cratesWriteVersion } from './crates-write-version.js';
import { isRateLimited } from './is-rate-limited.js';
import { relativeOrSelf } from './relative-or-self.js';

async function publishImpl(
  pkg: { name: string; path: string; crate?: string; features?: string[]; no_default_features?: boolean },
  version: string,
  ctx: Ctx,
): Promise<PublishResult> {
  if (await cratesIsPublished(pkg, version, ctx)) {
    return { status: 'already-published' };
  }

  // #135: --allow-dirty disarms cargo's own clean-tree guard, so reinstate a
  // narrower one — only the Cargo.toml we just wrote may be dirty. Sibling
  // package paths are whitelisted: a polyglot consumer's js package carries
  // install state during publish, and cargo only packs its own package dir.
  const unexpected = await scanDirtyOutsideManifest(
    ctx.cwd,
    pkg.path,
    ctx.artifactsRoot,
    ctx.siblingPackagePaths,
    ctx.managedManifestPaths,
  );
  if (unexpected !== null && unexpected.length > 0) {
    throw new Error(
      [
        `cargo publish: refusing to proceed; unexpected dirty files in the working tree outside ${relativeOrSelf(ctx.cwd, join(pkg.path, 'Cargo.toml'))}:`,
        ...unexpected.map((p) => `  - ${p}`),
        'Commit or stash these before publishing (putitoutthere passes --allow-dirty to cargo only to permit the managed version bump).',
      ].join('\n'),
    );
  }

  // #169: thread configured features through so cargo's publish-time
  // verification build exercises the same gates users will pull in.
  // Without this, a crate with a broken `cli` feature ships regardless.
  const baseArgs = ['publish', '--allow-dirty', '--verbose', '--manifest-path', join(pkg.path, 'Cargo.toml')];
  if (pkg.features && pkg.features.length > 0) {
    baseArgs.push('--features', pkg.features.join(','));
  }
  if (pkg.no_default_features === true) {
    baseArgs.push('--no-default-features');
  }

  // #331: internal e2e seams. `PIOT_CRATES_REGISTRY_PRIMARY` forces all
  // publish traffic at an alt-registry (the symmetric counterpart of
  // npm's `PIOT_NPM_REGISTRY`, for any future `*-first-publish` crates
  // fixture). `PIOT_CRATES_REGISTRY_FALLBACK` is a 429-only retry seam:
  // when real crates.io rate-limits routine PR-cadence e2e traffic
  // ("You have published too many versions of this crate in the last 24
  // hours"), retry once against the alt-registry so the run goes green.
  // Both are workflow-only — consumer production releases set neither
  // env var, so the publish path through this handler is byte-identical
  // to today's real-crates.io-only behavior in that case.
  const primaryOverride = nonEmpty(ctx.env.PIOT_CRATES_REGISTRY_PRIMARY);
  const fallbackUrl = nonEmpty(ctx.env.PIOT_CRATES_REGISTRY_FALLBACK);

  const runPublish = async (registryUrl?: string): Promise<void> => {
    // cargo refuses to invoke `publish --index <url>` without an
    // explicit `--token` argument at the CLI parser level — neither
    // CARGO_REGISTRY_TOKEN nor credentials.toml entries unblock it.
    // The alt-registry this workflow ships with (cargo-http-registry,
    // see e2e-fixture-job.yml) is configured `--no-auth` so any token
    // string is accepted; the value here is a placeholder for the CLI
    // to be willing to dispatch, not a secret. The primary path
    // (registryUrl undefined) leaves CARGO_REGISTRY_TOKEN handling
    // alone — that's the real-crates.io OIDC token exported by the
    // `rust-lang/crates-io-auth-action` workflow step.
    const args = registryUrl
      ? [...baseArgs, '--index', registryUrl, '--token', 'piot-alt-registry-placeholder']
      : baseArgs;
    await execCapture('cargo', args, {
      cwd: ctx.cwd,
      // #138: minimal env. The parent process.env leaks unrelated
      // secrets to cargo; forward only a known-safe baseline plus the
      // workflow-declared ctx.env (which carries CARGO_REGISTRY_TOKEN
      // and OIDC vars when present).
      env: buildSubprocessEnv(ctx.env, { CARGO_TERM_VERBOSE: 'true' }),
    });
  };

  try {
    await runPublish(primaryOverride);
  } catch (err) {
    const stderr = err instanceof ExecError ? err.stderr.trim() : undefined;
    // 429-only fallback. Predicate scoped narrowly to rate-limit prose
    // so non-rate-limit failures (auth, network, validation) surface
    // verbatim. Only fires when the workflow provisioned a fallback AND
    // a primary override isn't already in effect (primary is
    // authoritative for first-publish fixtures).
    if (
      primaryOverride === undefined &&
      fallbackUrl !== undefined &&
      isRateLimited(stderr)
    ) {
      // Surface the fallback engaging as a GH annotation so a reviewer
      // sees the real crates.io path was NOT exercised on this run and
      // isn't misled by the green check.
      process.stdout.write(
        `::warning::crates.io returned 429; falling back to ${fallbackUrl} (real OIDC-TP path not exercised this run)\n`,
      );
      try {
        await runPublish(fallbackUrl);
      } catch (retryErr) {
        const retryStderr = retryErr instanceof ExecError ? retryErr.stderr.trim() : undefined;
        const retryBase = retryErr instanceof Error ? retryErr.message : String(retryErr);
        throw new Error(
          `cargo publish (fallback ${fallbackUrl}) failed${retryStderr ? `:\n${elideMiddle(retryStderr)}` : `: ${retryBase}`}`,
          { cause: retryErr },
        );
      }
      return {
        status: 'published',
        url: `${fallbackUrl.replace(/\/$/, '')}/api/v1/crates/${crateNameFor(pkg)}/${version}`,
      };
    }
    // crates.io's Trusted Publishing binds to an already-published
    // crate: the OIDC mint succeeds and the exchanged token reaches
    // cargo, but the registry returns a 404 ("crate `<name>` does not
    // exist or you do not have permission to publish to it") on the
    // very first publish. The naive "auth failed?" interpretation
    // sends consumers down a credentials rabbit-hole when the real
    // fix is one bootstrap publish with a classic CARGO_REGISTRY_TOKEN.
    // Detect this exact shape and surface the bootstrap hint inline.
    // Suppressed under the e2e seam (primary override in effect) — the
    // alt-registry is configured `--no-auth` and doesn't model TP, so
    // a 404 there is a different bug. #284.
    const tpStderr = matchFirstPublishTpRejection(stderr);
    if (primaryOverride === undefined && tpStderr !== null) {
      throw new Error(
        [
          `[${ErrorCodes.CRATES_FIRST_PUBLISH_TP_REJECTED}] cargo publish: crates.io rejected publishing "${crateNameFor(pkg)}" because the crate has never been published.`,
          'crates.io Trusted Publishing binds to an already-published crate, so the very first release of a new crate name cannot use the TP path.',
          'Bootstrap by setting CARGO_REGISTRY_TOKEN (a classic crates.io API token) for the first publish; every release after that can use trusted publishing.',
          `\n--- cargo stderr ---\n${elideMiddle(tpStderr)}`,
        ].join('\n'),
        { cause: err },
      );
    }
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(
      `cargo publish failed${stderr ? `:\n${elideMiddle(stderr)}` : `: ${base}`}`,
      { cause: err },
    );
  }

  return {
    status: 'published',
    url: primaryOverride
      ? `${primaryOverride.replace(/\/$/, '')}/api/v1/crates/${crateNameFor(pkg)}/${version}`
      : `${cratesRegistry()}/crates/${crateNameFor(pkg)}/${version}`,
  };
}

export const crates: Handler = {
  kind: 'crates',
  isPublished: cratesIsPublished,
  latestVersion: cratesLatestVersion,
  trustPosture: cratesTrustPosture,
  writeVersion: cratesWriteVersion,
  publish: publishImpl,
};
