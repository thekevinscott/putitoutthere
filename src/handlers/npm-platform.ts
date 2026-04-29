/**
 * npm platform-package orchestration for `build = "napi"` and
 * `build = "bundled-cli"`.
 *
 * Flow per plan §13.7:
 *   1. For each (build entry, target), synthesize a per-platform package
 *      with narrowed os/cpu fields and the platform binary.
 *   2. Publish each per-platform package (skip already-published).
 *   3. Rewrite the main package's `package.json` to add
 *      `optionalDependencies` pointing at the just-published versions
 *      across every build entry's family.
 *   4. Caller (npm.ts:publishImpl) publishes the main package last.
 *
 * Ordering is enforced: a failed platform publish short-circuits
 * before step 3, so the main package isn't published in an
 * inconsistent state.
 *
 * Multi-mode (#dirsql): when `build` is an array with more than one
 * entry, each entry contributes its own platform-package family. The
 * artifact directory for each (mode, triple) carries a mode infix to
 * keep `napi` and `bundled-cli` artifacts distinct on the build side.
 *
 * Issue #19. Plan: §13.7, §12.2.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sanitizeArtifactName } from '../config.js';
import type { Ctx } from '../types.js';
import { buildSubprocessEnv, nonEmpty } from '../env.js';

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
  if (build === undefined) return [];
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
      const stagingDir = synthesizePlatformPackage(
        pkg,
        entry,
        target,
        platformName,
        version,
        ctx,
        isMulti,
      );
      try {
        npmPublish(stagingDir, pkg, ctx);
        published.push(platformName);
      } finally {
        /* v8 ignore next -- cleanup after publish; failure here is cosmetic */
        rmSync(stagingDir, { recursive: true, force: true });
      }
    }
  }

  rewriteOptionalDependencies(pkg, version, [...published, ...skipped]);

  return { published, skipped };
}

/**
 * Resolve a platform-package name template. `{name}`, `{scope}`,
 * `{base}`, `{triple}`, and `{mode}` are substituted; unknown
 * placeholders throw (config-load validation should catch these
 * earlier — this guard is defensive).
 */
export function resolvePlatformName(
  template: string,
  vars: { name: string; triple: string; mode: NpmBuildMode },
): string {
  const scopedMatch = /^@([^/]+)\/(.+)$/.exec(vars.name);
  const scope = scopedMatch ? scopedMatch[1]! : '';
  const base = scopedMatch ? scopedMatch[2]! : vars.name;
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    switch (key) {
      case 'name':
        return vars.name;
      case 'scope':
        return scope;
      case 'base':
        return base;
      case 'triple':
        return vars.triple;
      case 'mode':
        return vars.mode;
      /* v8 ignore start -- config-load validation rejects unknown placeholders; this branch is defensive */
      default:
        throw new Error(`unknown placeholder {${key}} in name template`);
    }
    /* v8 ignore stop */
  });
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

/* --------------------------- internals --------------------------- */

function isPlatformPublished(
  platformName: string,
  version: string,
  ctx: Ctx,
): Promise<boolean> {
  try {
    execFileSync('npm', ['view', `${platformName}@${version}`, 'version'], {
      cwd: ctx.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

function synthesizePlatformPackage(
  pkg: PlatformPkg,
  entry: NpmBuildEntry,
  target: string,
  platformName: string,
  version: string,
  ctx: Ctx,
  isMulti: boolean,
): string {
  const staging = mkdtempSync(join(tmpdir(), 'putitoutthere-plat-'));

  // #237: encode pkg.name to match the on-disk artifact directory the
  // planner emitted (slash-containing names like `js/foo` land at
  // `artifacts/js__foo-<triple>/`, not `artifacts/js/foo-<triple>/`).
  const artifactName = platformArtifactName(pkg.name, entry.mode, target, isMulti);
  /* v8 ignore next -- tests inject artifactsRoot explicitly; publish.ts always sets it */
  const artifactsRoot = ctx.artifactsRoot ?? join(ctx.cwd, 'artifacts');
  const artifactDir = join(artifactsRoot, artifactName);

  const files = readdirSync(artifactDir);
  /* v8 ignore start -- completeness check already verified the artifact tree */
  if (files.length === 0) {
    throw new Error(`platform artifact empty: ${artifactDir}`);
  }
  /* v8 ignore stop */
  for (const f of files) {
    cpSync(join(artifactDir, f), join(staging, f), { recursive: true });
  }

  const { os, cpu, libc } = targetToOsCpu(target);
  const fileList = readdirSync(staging);

  // npm provenance verifier compares package.json.repository.url against
  // the publishing GitHub repo URL baked into the sigstore bundle. A
  // synthesized platform package without `repository` fails with E422
  // "repository.url is \"\"". Inherit repository/license/homepage from
  // the main package so per-platform tarballs validate.
  const mainPkgRaw = readFileSync(join(pkg.path, 'package.json'), 'utf8');
  const mainPkg = JSON.parse(mainPkgRaw) as Record<string, unknown>;

  const platformJson: Record<string, unknown> = {
    name: platformName,
    version,
    os,
    cpu,
    files: fileList,
    main: pickMainFile(fileList, entry.mode),
    ...(libc !== undefined ? { libc } : {}),
    ...(mainPkg['repository'] !== undefined ? { repository: mainPkg['repository'] } : {}),
    ...(mainPkg['license'] !== undefined ? { license: mainPkg['license'] } : {}),
    ...(mainPkg['homepage'] !== undefined ? { homepage: mainPkg['homepage'] } : {}),
  };
  writeFileSync(
    join(staging, 'package.json'),
    JSON.stringify(platformJson, null, 2) + '\n',
    'utf8',
  );

  return staging;
}

function npmPublish(stagingDir: string, pkg: PlatformPkg, ctx: Ctx): void {
  const hasOidc = Boolean(
    nonEmpty(ctx.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) ??
      nonEmpty(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN),
  );
  const access = pkg.access ?? 'public';
  const args: string[] = ['publish', `--access=${access}`];
  if (pkg.tag) args.push(`--tag=${pkg.tag}`);
  if (hasOidc) args.push('--provenance');

  try {
    execFileSync('npm', args, {
      cwd: stagingDir,
      // #138: minimal env; don't leak parent process.env to npm.
      env: buildSubprocessEnv(ctx.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString('utf8').trim();
    // npm CLI's retry-on-transient-network-error: a successful PUT that
    // the registry acked but for which npm saw a flaky response (timeout,
    // 502, connection reset) gets retried with the same payload. The
    // retry's PUT lands on a registry that already has the new version
    // and gets E403 "cannot publish over the previously published versions".
    // The first attempt actually succeeded — the package + provenance are
    // on the registry — so treat this exact stderr shape as success.
    if (looksLikePublishOverRace(stderr)) {
      return;
    }
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(
      `npm publish (platform) failed${stderr ? `:\n${stderr}` : `: ${base}`}`,
      { cause: err },
    );
  }
}

/**
 * Match the specific stderr npm emits when its internal retry-on-transient-
 * network-error fires after a successful PUT: the second attempt lands on a
 * registry that already has the version and gets `E403 ... You cannot
 * publish over the previously published versions: <ver>`. The package is
 * already where we wanted it; npm just exits non-zero on the duplicate
 * write.
 */
export function looksLikePublishOverRace(stderr: string | undefined): boolean {
  if (!stderr) return false;
  return /cannot publish over the previously published versions/i.test(stderr);
}

function rewriteOptionalDependencies(
  pkg: PlatformPkg,
  version: string,
  platformPackages: readonly string[],
): void {
  const p = join(pkg.path, 'package.json');
  const raw = readFileSync(p, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const optionalDeps: Record<string, string> = {};
  for (const name of platformPackages) {
    optionalDeps[name] = version;
  }
  parsed.optionalDependencies = {
    ...((parsed.optionalDependencies) ?? {}),
    ...optionalDeps,
  };

  /* v8 ignore start -- indent detection + trailing-newline preservation tested via snapshot in npm.test.ts; here we just need something valid */
  const indent = /^(?<indent>[ \t]+)"/m.exec(raw)?.groups?.indent;
  const indentArg: number | string = indent === undefined ? 2 : indent.includes('\t') ? '\t' : indent.length;
  const trailing = raw.endsWith('\n') ? '\n' : '';
  /* v8 ignore stop */
  writeFileSync(p, JSON.stringify(parsed, null, indentArg) + trailing, 'utf8');
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

function pickMainFile(files: readonly string[], mode: NpmBuildMode): string {
  if (mode === 'napi') {
    const node = files.find((f) => f.endsWith('.node'));
    /* v8 ignore next -- completeness check for napi ensures a .node file is present */
    return node ?? files[0]!;
  }
  // bundled-cli: first non-package.json file.
  const first = files.find((f) => f !== 'package.json');
  /* v8 ignore next -- artifact always has a payload file */
  return first ?? files[0]!;
}
