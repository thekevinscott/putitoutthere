/**
 * npm platform-package orchestration for `build = "napi"` and
 * `build = "bundled-cli"` (#19; plan §13.7, §12.2). Ordering is enforced: a
 * failed platform publish short-circuits before the main `package.json` gains
 * its `optionalDependencies`, so the main package never ships inconsistent.
 */

import { rm } from 'node:fs/promises';

import { sanitizeArtifactName } from '../config.js';
import type { Ctx } from '../types.js';
import { nonEmpty } from '../env.js';
import { awaitPlatformsVisible } from './await-platforms-visible.js';
import { isPlatformPublished } from './is-platform-published.js';
import { publishPlatformPackage } from './publish-platform-package.js';
import { resolvePlatformName } from './resolve-platform-name.js';
import { rewriteOptionalDependencies } from './rewrite-optional-dependencies.js';
import { synthesizePlatformPackage } from './synthesize-platform-package.js';

export { looksLikePublishOverRace } from './looks-like-publish-over-race.js';
export { toRustTriple } from './to-rust-triple.js';

export type NpmBuildMode = 'napi' | 'bundled-cli';

/**
 * Default template for platform package names. Resolves to
 * `<main-name>-<triple>`, matching the historical single-mode shape.
 */
export const DEFAULT_NAME_TEMPLATE = '{name}-{triple}';

/** Variables surfaced to `name` templates. `{version}` is intentionally
 *  excluded — platform package names are immutable identifiers; the
 *  registry pins `name@version` in optionalDependencies, so embedding
 *  the version in the name itself defeats the cascade. */
export const ALLOWED_NAME_VARIABLES = ['name', 'scope', 'base', 'triple', 'mode'] as const;

/** A normalized build entry. Object form of every entry the consumer
 *  may write under `build`; the config layer coerces string entries
 *  (`"napi"`) into this shape with `name = DEFAULT_NAME_TEMPLATE`. */
export interface NpmBuildEntry {
  mode: NpmBuildMode;
  name: string;
}

/** Raw `build` field as written in toml — string, array, or absent. */
export type NpmBuildField =
  | NpmBuildMode
  | readonly (NpmBuildMode | { mode: NpmBuildMode; name: string })[]
  | undefined;

/**
 * Coerce any of the accepted `build` shapes into a normalized entry
 * array. Bare-string entries default to `DEFAULT_NAME_TEMPLATE` so
 * historical `build = "napi"` configs produce the same platform-package
 * names as before. Returns `[]` when `build` is omitted, which signals
 * "vanilla — no platform packages".
 */
export function normalizeBuild(build: NpmBuildField): readonly NpmBuildEntry[] {
  if (build === undefined) {return [];}
  const arr = typeof build === 'string' ? [build] : build;
  return arr.map((e) =>
    typeof e === 'string'
      ? { mode: e, name: DEFAULT_NAME_TEMPLATE }
      : { mode: e.mode, name: e.name },
  );
}

export interface PlatformPkg {
  name: string;
  path: string;
  npm?: string | undefined;
  access?: 'public' | 'restricted' | undefined;
  tag?: string | undefined;
  /** One or more entries — at least one mode, optionally a `name` template. */
  build: readonly NpmBuildEntry[];
  targets: readonly string[];
}

/**
 * Publish every per-platform package across every build entry, then
 * rewrite the main package.json to add `optionalDependencies`. Returns
 * the list of published platform names so the caller can log them.
 *
 * On any failure, throws before the main package.json is modified.
 */
export async function publishPlatforms(
  pkg: PlatformPkg,
  version: string,
  ctx: Ctx,
): Promise<{ published: string[]; skipped: string[] }> {
  const mainName = pkg.npm ?? pkg.name;
  const published: string[] = [];
  const skipped: string[] = [];
  const isMulti = pkg.build.length > 1;

  for (const entry of pkg.build) {
    for (const target of pkg.targets) {
      const platformName = resolvePlatformName(entry.name, {
        name: mainName,
        triple: target,
        mode: entry.mode,
      });
      if (await isPlatformPublished(platformName, version, ctx)) {
        skipped.push(platformName);
        continue;
      }
      const stagingDir = await synthesizePlatformPackage(
        pkg,
        entry,
        target,
        platformName,
        version,
        ctx,
        isMulti,
      );
      try {
        await publishPlatformPackage(stagingDir, pkg, ctx);
        published.push(platformName);
      } finally {
        // Cleanup is best-effort. The publish already happened, and the
        // all-or-nothing-per-package guarantee is about the publish, not
        // the staging tempdir. Awaiting `rm` in `finally` would let a
        // cleanup rejection (EBUSY/EPERM on Windows runners even with
        // force:true) REPLACE the block's outcome and mask a successful
        // publish, misreporting `published`. Swallow the failure with a
        // warning instead — a leaked tempdir on an ephemeral runner is
        // genuinely cosmetic; the already-published artifact is what
        // matters.
        try {
          await rm(stagingDir, { recursive: true, force: true });
        } catch (err) {
          ctx.log.warn(
            `failed to clean up platform staging directory ${stagingDir}`,
            { error: err },
          );
        }
      }
    }
  }

  const registryOverride = nonEmpty(ctx.env.PIOT_NPM_REGISTRY) ?? nonEmpty(process.env.PIOT_NPM_REGISTRY);
  await awaitPlatformsVisible(published, version, registryOverride);

  await rewriteOptionalDependencies(pkg, version, [...published, ...skipped]);

  return { published, skipped };
}

/**
 * Plan-time + handler-time: compute the artifact directory name for a
 * given (package, mode, triple). The mode infix is only added when
 * the package has multiple build entries, so single-mode packages keep
 * their historical `<safe>-<triple>` artifact layout byte-for-byte.
 */
export function platformArtifactName(
  pkgName: string,
  mode: NpmBuildMode,
  triple: string,
  isMulti: boolean,
): string {
  const safe = sanitizeArtifactName(pkgName);
  return isMulti ? `${safe}-${mode}-${triple}` : `${safe}-${triple}`;
}

interface OsCpu {
  os: string[];
  cpu: string[];
  libc?: string[];
}

/**
 * Explicit mapping from target triple to npm `os`/`cpu`/`libc`.
 *
 * Covers both napi-rs short-form triples (`linux-x64-gnu`) and Rust
 * triples (`x86_64-unknown-linux-gnu`). Unmapped triples throw — see
 * `targetToOsCpu` — so broken platform packages never reach npm with
 * empty `os`/`cpu` filters (which would install them everywhere).
 *
 * Issue #170.
 */
const TRIPLE_MAP: Record<string, { os: string[]; cpu: string[]; libc?: string[] }> = {
  // napi-rs short form: linux
  'linux-x64-gnu': { os: ['linux'], cpu: ['x64'], libc: ['glibc'] },
  'linux-x64-musl': { os: ['linux'], cpu: ['x64'], libc: ['musl'] },
  'linux-arm64-gnu': { os: ['linux'], cpu: ['arm64'], libc: ['glibc'] },
  'linux-arm64-musl': { os: ['linux'], cpu: ['arm64'], libc: ['musl'] },
  'linux-arm-gnueabihf': { os: ['linux'], cpu: ['arm'], libc: ['glibc'] },
  'linux-arm-musleabihf': { os: ['linux'], cpu: ['arm'], libc: ['musl'] },

  // napi-rs short form: darwin
  'darwin-x64': { os: ['darwin'], cpu: ['x64'] },
  'darwin-arm64': { os: ['darwin'], cpu: ['arm64'] },

  // napi-rs short form: windows
  'win32-x64-msvc': { os: ['win32'], cpu: ['x64'] },
  'win32-arm64-msvc': { os: ['win32'], cpu: ['arm64'] },

  // Rust target triples: linux
  'x86_64-unknown-linux-gnu': { os: ['linux'], cpu: ['x64'], libc: ['glibc'] },
  'x86_64-unknown-linux-musl': { os: ['linux'], cpu: ['x64'], libc: ['musl'] },
  'aarch64-unknown-linux-gnu': { os: ['linux'], cpu: ['arm64'], libc: ['glibc'] },
  'aarch64-unknown-linux-musl': { os: ['linux'], cpu: ['arm64'], libc: ['musl'] },
  'armv7-unknown-linux-gnueabihf': { os: ['linux'], cpu: ['arm'], libc: ['glibc'] },
  'armv7-unknown-linux-musleabihf': { os: ['linux'], cpu: ['arm'], libc: ['musl'] },

  // Rust target triples: darwin
  'x86_64-apple-darwin': { os: ['darwin'], cpu: ['x64'] },
  'aarch64-apple-darwin': { os: ['darwin'], cpu: ['arm64'] },

  // Rust target triples: windows
  'x86_64-pc-windows-msvc': { os: ['win32'], cpu: ['x64'] },
  'aarch64-pc-windows-msvc': { os: ['win32'], cpu: ['arm64'] },
};

/**
 * Maps a napi-rs or Rust target triple to npm `os`/`cpu`/`libc` fields.
 *
 * Lookup is exact (case-insensitive). Unmapped triples throw so broken
 * platform packages — which would otherwise publish with empty `os`/
 * `cpu` filters and install everywhere — never reach the registry.
 */
export function targetToOsCpu(target: string): OsCpu {
  const entry = TRIPLE_MAP[target.toLowerCase()];
  if (!entry) {
    throw new Error(unmappedTripleMessage(target));
  }
  return entry.libc !== undefined
    ? { os: entry.os, cpu: entry.cpu, libc: entry.libc }
    : { os: entry.os, cpu: entry.cpu };
}

/**
 * Plan-time guard: assert a napi target triple is mapped in `TRIPLE_MAP`
 * before any CI matrix row is emitted for it. Throws with the same
 * vocabulary as `targetToOsCpu`, plus the offending package name so the
 * user knows which `[[package]]` entry to fix.
 *
 * Issue #170 follow-up: failing fast at plan time beats failing
 * mid-publish after a matrix has already run.
 */
export function assertTripleSupported(triple: string, packageName: string): void {
  if (TRIPLE_MAP[triple.toLowerCase()] === undefined) {
    throw new Error(
      `Package "${packageName}": ${unmappedTripleMessage(triple)}`,
    );
  }
}

function unmappedTripleMessage(target: string): string {
  return `Target triple "${target}" is not mapped to npm os/cpu. Add it to TRIPLE_MAP in src/handlers/npm-platform.ts.`;
}
