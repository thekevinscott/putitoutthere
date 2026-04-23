/**
 * npm platform-package orchestration for `build = "napi"` and
 * `build = "bundled-cli"`.
 *
 * Flow per plan §13.7:
 *   1. For each target, synthesize a per-platform package
 *      `{name}-{target}` with narrowed os/cpu fields and the
 *      platform binary.
 *   2. Publish each per-platform package (skip already-published).
 *   3. Rewrite the main package's `package.json` to add
 *      `optionalDependencies` pointing at the just-published versions.
 *   4. Caller (npm.ts:publishImpl) publishes the main package last.
 *
 * Ordering is enforced: a failed platform publish short-circuits
 * before step 3, so the main package isn't published in an
 * inconsistent state.
 *
 * Issue #19. Plan: §13.7, §12.2.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Ctx } from '../types.js';
import { nonEmpty } from '../env.js';

export interface PlatformPkg {
  name: string;
  path: string;
  npm?: string | undefined;
  access?: 'public' | 'restricted' | undefined;
  tag?: string | undefined;
  build: 'napi' | 'bundled-cli';
  targets: readonly string[];
}

/**
 * Publish every per-platform package. Then rewrite the main
 * package.json to add `optionalDependencies`. Returns the list of
 * published platform names so the caller can log them.
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

  for (const target of pkg.targets) {
    const platformName = platformPackageName(mainName, target);
    if (await isPlatformPublished(platformName, version, ctx)) {
      skipped.push(platformName);
      continue;
    }
    if (ctx.dryRun) {
      skipped.push(platformName);
      continue;
    }
    const stagingDir = synthesizePlatformPackage(pkg, target, version, ctx);
    try {
      npmPublish(stagingDir, pkg, ctx);
      published.push(platformName);
    } finally {
      /* v8 ignore next -- cleanup after publish; failure here is cosmetic */
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  if (!ctx.dryRun) {
    rewriteOptionalDependencies(pkg, version, [...published, ...skipped]);
  }

  return { published, skipped };
}

/**
 * Computes the per-platform package name. Mirrors napi-rs's scaffold
 * convention:
 *   - unscoped: `{name}-{target}`
 *   - scoped:   `@scope/{base}-{target}`
 */
export function platformPackageName(mainName: string, target: string): string {
  const scopedMatch = /^@([^/]+)\/(.+)$/.exec(mainName);
  /* v8 ignore next -- scoped packages routed through the branch below */
  if (scopedMatch) {
    const [, scope, base] = scopedMatch;
    return `@${scope!}/${base!}-${target}`;
  }
  return `${mainName}-${target}`;
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
  target: string,
  version: string,
  ctx: Ctx,
): string {
  const mainName = pkg.npm ?? pkg.name;
  const platformName = platformPackageName(mainName, target);
  const staging = mkdtempSync(join(tmpdir(), 'putitoutthere-plat-'));

  const artifactName = `${pkg.name}-${target}`;
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

  const platformJson: Record<string, unknown> = {
    name: platformName,
    version,
    os,
    cpu,
    files: fileList,
    main: pickMainFile(fileList, pkg.build),
    ...(libc !== undefined ? { libc } : {}),
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
      env: { ...process.env, ...ctx.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString('utf8').trim();
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(
      `npm publish (platform) failed${stderr ? `:\n${stderr}` : `: ${base}`}`,
      { cause: err },
    );
  }
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
    ...((parsed.optionalDependencies as Record<string, string> | undefined) ?? {}),
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

function pickMainFile(files: readonly string[], build: 'napi' | 'bundled-cli'): string {
  if (build === 'napi') {
    const node = files.find((f) => f.endsWith('.node'));
    /* v8 ignore next -- completeness check for napi ensures a .node file is present */
    return node ?? files[0]!;
  }
  // bundled-cli: first non-package.json file.
  const first = files.find((f) => f !== 'package.json');
  /* v8 ignore next -- artifact always has a payload file */
  return first ?? files[0]!;
}
