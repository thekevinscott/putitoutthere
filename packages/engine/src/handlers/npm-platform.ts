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

import { chmod, cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sanitizeArtifactName } from '../config.js';
import type { Ctx } from '../types.js';
import { buildSubprocessEnv, nonEmpty } from '../env.js';
import { execCapture } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';

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
        await npmPublish(stagingDir, pkg, ctx);
        published.push(platformName);
      } finally {
        /* v8 ignore next -- cleanup after publish; failure here is cosmetic */
        await rm(stagingDir, { recursive: true, force: true });
      }
    }
  }

  await rewriteOptionalDependencies(pkg, version, [...published, ...skipped]);

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

async function isPlatformPublished(
  platformName: string,
  version: string,
  ctx: Ctx,
): Promise<boolean> {
  try {
    await execCapture('npm', ['view', `${platformName}@${version}`, 'version'], {
      cwd: ctx.cwd,
    });
    return true;
  } catch {
    return false;
  }
}

async function synthesizePlatformPackage(
  pkg: PlatformPkg,
  entry: NpmBuildEntry,
  target: string,
  platformName: string,
  version: string,
  ctx: Ctx,
  isMulti: boolean,
): Promise<string> {
  const staging = await mkdtemp(join(tmpdir(), 'putitoutthere-plat-'));

  // #237: encode pkg.name to match the on-disk artifact directory the
  // planner emitted (slash-containing names like `js/foo` land at
  // `artifacts/js__foo-<triple>/`, not `artifacts/js/foo-<triple>/`).
  const artifactName = platformArtifactName(pkg.name, entry.mode, target, isMulti);
  /* v8 ignore next -- tests inject artifactsRoot explicitly; publish.ts always sets it */
  const artifactsRoot = ctx.artifactsRoot ?? join(ctx.cwd, 'artifacts');
  const artifactDir = join(artifactsRoot, artifactName);

  const files = await readdir(artifactDir);
  /* v8 ignore start -- completeness check already verified the artifact tree */
  if (files.length === 0) {
    throw new Error(`platform artifact empty: ${artifactDir}`);
  }
  /* v8 ignore stop */
  for (const f of files) {
    await cp(join(artifactDir, f), join(staging, f), { recursive: true });
  }

  const { os, cpu, libc } = targetToOsCpu(target);
  const fileList = await readdir(staging);
  const mainFile = pickMainFile(fileList, entry.mode);

  // #365: bundled-cli binaries ship as package data referenced via
  // `main`, not as a `bin` entry, so npm never sets the executable bit —
  // and it is stripped crossing the Actions artifact upload/download
  // boundary regardless of the mode `cargo build` produced. Restore +x
  // on the staged binary for non-Windows targets; without it the
  // launcher's spawn of the resolved binary EACCESes at runtime.
  if (entry.mode === 'bundled-cli' && !os.includes('win32')) {
    await chmod(join(staging, mainFile), 0o755);
  }

  // npm provenance verifier compares package.json.repository.url against
  // the publishing GitHub repo URL baked into the sigstore bundle. A
  // synthesized platform package without `repository` fails with E422
  // "repository.url is \"\"". Inherit repository/license/homepage from
  // the main package so per-platform tarballs validate.
  const mainPkgRaw = await readFile(join(pkg.path, 'package.json'), 'utf8');
  const mainPkg = JSON.parse(mainPkgRaw) as Record<string, unknown>;

  const platformJson: Record<string, unknown> = {
    name: platformName,
    version,
    os,
    cpu,
    files: fileList,
    main: mainFile,
    ...(libc !== undefined ? { libc } : {}),
    ...(mainPkg['repository'] !== undefined ? { repository: mainPkg['repository'] } : {}),
    ...(mainPkg['license'] !== undefined ? { license: mainPkg['license'] } : {}),
    ...(mainPkg['homepage'] !== undefined ? { homepage: mainPkg['homepage'] } : {}),
  };
  await writeFile(
    join(staging, 'package.json'),
    JSON.stringify(platformJson, null, 2) + '\n',
    'utf8',
  );

  return staging;
}

async function npmPublish(stagingDir: string, pkg: PlatformPkg, ctx: Ctx): Promise<void> {
  // See src/handlers/npm.ts for the PIOT_NPM_REGISTRY rationale (#304):
  // internal e2e seam, suppresses provenance + assumes `.npmrc`-supplied
  // auth at the override registry.
  const registryOverride = nonEmpty(ctx.env.PIOT_NPM_REGISTRY) ?? nonEmpty(process.env.PIOT_NPM_REGISTRY);
  const hasOidc =
    !registryOverride &&
    Boolean(
      nonEmpty(ctx.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) ??
        nonEmpty(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN),
    );
  const access = pkg.access ?? 'public';
  const args: string[] = ['publish', `--access=${access}`];
  if (pkg.tag) {args.push(`--tag=${pkg.tag}`);}
  if (hasOidc) {args.push('--provenance');}
  if (registryOverride) {args.push(`--registry=${registryOverride}`);}
  // #305: pass the synthesized package directory as a positional <folder>
  // arg to `npm publish`, not as the cwd. npm reads `.npmrc` from cwd
  // upward, and any auth the consumer wrote alongside their package
  // (e.g. the `_authToken` entries the e2e workflow writes into
  // `fixture-tree/.npmrc` to authenticate against Verdaccio, and the
  // analogous NPM_TOKEN-bootstrap shape consumers use against real npm)
  // lives at `pkg.path`. Running with `cwd: stagingDir` (a tempdir) lost
  // that auth — the platform PUTs went out unauthenticated, registry
  // returned 4xx, the engine reported "npm publish (platform) failed".
  // Mirrors what npm.ts:publishImpl already does for the main package.
  args.push(stagingDir);

  try {
    await execCapture('npm', args, {
      cwd: pkg.path,
      // #138: minimal env; don't leak parent process.env to npm.
      env: buildSubprocessEnv(ctx.env),
    });
  } catch (err) {
    const stderr = err instanceof ExecError ? err.stderr.trim() : undefined;
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
    // Attestation edition of the same retry race: npm re-submits an
    // identical provenance attestation and Sigstore/Rekor rejects the
    // duplicate with TLOG_CREATE_ENTRY_ERROR (409). A 409 alone does not
    // prove the registry upload landed, so re-probe `npm view` before
    // deciding: present => the publish actually succeeded (benign dup);
    // absent => a genuine partial publish that a fresh run (new
    // attestation) resolves.
    if (looksLikeTlogDuplicate(stderr)) {
      const staged = await readStagedIdentity(stagingDir);
      if (await platformPublished(staged.name, staged.version, ctx)) {
        return;
      }
      throw new Error(
        `npm publish (platform) failed: Sigstore transparency-log dedupe ` +
          `(TLOG_CREATE_ENTRY_ERROR) and ${staged.name}@${staged.version} is not ` +
          `on the registry — npm's provenance retry re-submitted an identical ` +
          `attestation. Re-run the release to mint a fresh attestation.` +
          `${stderr ? `\n${stderr}` : ''}`,
        { cause: err },
      );
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
  if (!stderr) {return false;}
  return /cannot publish over the previously published versions/i.test(stderr);
}

/**
 * Match npm's Sigstore/Rekor transparency-log dedupe error. The same
 * retry-on-transient-network-error that produces the publish-over race
 * (above) also re-submits an identical `--provenance` attestation; Rekor
 * rejects the duplicate with `TLOG_CREATE_ENTRY_ERROR` / "an equivalent
 * entry already exists in the transparency log". Unlike the publish-over
 * race, a 409 here does NOT by itself prove the package landed (the first
 * submit may have written the Rekor entry but failed the registry PUT),
 * so callers must re-probe `npm view` to disambiguate.
 */
export function looksLikeTlogDuplicate(stderr: string | undefined): boolean {
  if (!stderr) {return false;}
  return /TLOG_CREATE_ENTRY_ERROR|equivalent entry already exists in the transparency log/i.test(
    stderr,
  );
}

/**
 * `npm view <name>@<version>` existence probe. Mirrors
 * `isPlatformPublished`; kept as a separate helper so the publish catch's
 * re-probe path reads independently.
 */
async function platformPublished(name: string, version: string, ctx: Ctx): Promise<boolean> {
  try {
    await execCapture('npm', ['view', `${name}@${version}`, 'version'], {
      cwd: ctx.cwd,
    });
    return true;
  } catch {
    return false;
  }
}

/** Read the synthesized platform package's name + version back from its
 *  staged package.json (written by `synthesizePlatformPackage`). */
async function readStagedIdentity(stagingDir: string): Promise<{ name: string; version: string }> {
  const pkg = JSON.parse(await readFile(join(stagingDir, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  return { name: pkg.name, version: pkg.version };
}

async function rewriteOptionalDependencies(
  pkg: PlatformPkg,
  version: string,
  platformPackages: readonly string[],
): Promise<void> {
  const p = join(pkg.path, 'package.json');
  const raw = await readFile(p, 'utf8');
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
  await writeFile(p, JSON.stringify(parsed, null, indentArg) + trailing, 'utf8');
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

/**
 * napi-rs short form → Rust target triple. npm `targets` are written in
 * napi-rs short form (`linux-x64-gnu`); the bundled-cli cross-compile path
 * feeds the triple to `rustup target add` / `cargo build --target`, which
 * only understand Rust triples (`x86_64-unknown-linux-gnu`). This is the
 * napi→rust half of the correspondence `TRIPLE_MAP` already encodes for
 * os/cpu — every napi key in `TRIPLE_MAP` has an entry here, so a triple
 * that passes `assertTripleSupported` always resolves.
 *
 * Issue #387.
 */
const NAPI_TO_RUST: Record<string, string> = {
  'linux-x64-gnu': 'x86_64-unknown-linux-gnu',
  'linux-x64-musl': 'x86_64-unknown-linux-musl',
  'linux-arm64-gnu': 'aarch64-unknown-linux-gnu',
  'linux-arm64-musl': 'aarch64-unknown-linux-musl',
  'linux-arm-gnueabihf': 'armv7-unknown-linux-gnueabihf',
  'linux-arm-musleabihf': 'armv7-unknown-linux-musleabihf',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64-msvc': 'x86_64-pc-windows-msvc',
  'win32-arm64-msvc': 'aarch64-pc-windows-msvc',
};

/** The Rust triples the map can produce. A consumer who declares
 *  rust-flavor `targets` (the pypi convention, also accepted on npm) gets
 *  identity passthrough — the triple is already what rustup/cargo want. */
const RUST_TRIPLES: ReadonlySet<string> = new Set(Object.values(NAPI_TO_RUST));

/**
 * Resolve a target triple to its Rust (rustup/cargo) form.
 *
 * - napi-rs short form (`linux-x64-gnu`) → its Rust triple
 *   (`x86_64-unknown-linux-gnu`).
 * - a Rust triple → itself (identity), so rust-flavor `targets` pass
 *   through untouched.
 * - anything else throws, matching `targetToOsCpu`'s posture: an
 *   unmappable triple fails loud at plan time rather than reaching
 *   `rustup target add` with a triple it rejects (#387).
 *
 * Lookup is case-insensitive, mirroring `targetToOsCpu`.
 */
export function toRustTriple(target: string): string {
  const key = target.toLowerCase();
  const mapped = NAPI_TO_RUST[key];
  if (mapped !== undefined) {
    return mapped;
  }
  if (RUST_TRIPLES.has(key)) {
    return key;
  }
  throw new Error(
    `Target triple "${target}" has no known Rust-triple mapping. ` +
      `Add it to NAPI_TO_RUST in src/handlers/npm-platform.ts.`,
  );
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
