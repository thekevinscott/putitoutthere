/**
 * npm platform-package orchestration for `build = "napi"` and
 * `build = "bundled-cli"` (#19; plan §13.7, §12.2). Ordering is enforced: a
 * failed platform publish short-circuits before the main `package.json` gains
 * its `optionalDependencies`, so the main package never ships inconsistent.
 */

export { looksLikePublishOverRace } from './looks-like-publish-over-race.js';
export { platformArtifactName } from './platform-artifact-name.js';
export { publishPlatforms } from './publish-platforms.js';
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

export interface OsCpu {
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

export { TRIPLE_MAP };
