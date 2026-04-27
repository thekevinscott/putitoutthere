/**
 * `putitoutthere.toml` loader and validator.
 *
 * Shape per plan.md §6. Handler-specific fields per §6.4. `targets`
 * cross-validation per §12.2: only meaningful for `maturin` / `napi` /
 * `bundled-cli` builds.
 *
 * Two entry points:
 *  - `parseConfig(toml)`  pure function over a TOML string; used in tests.
 *  - `loadConfig(path)`   reads the file and calls parseConfig.
 *
 * Unknown fields are a hard error (no silent drops). Zod's `.strict()`
 * enforces this at every level.
 */

import { readFileSync } from 'node:fs';
import { parse as parseToml } from 'smol-toml';
import { z, type ZodError } from 'zod';

import { DEFAULT_TAG_FORMAT } from './tag-template.js';

/* ------------------------------ artifact-name encoding ------------------------------ */

// #230: actions/upload-artifact@v4 rejects these characters in artifact names.
// `/` is the only one realistically used in `pkg.name` (polyglot-monorepo
// grouping, e.g. `py/foo`); the rest are rejected at config load since they
// have no realistic identifier use and would also break registry naming.
const ARTIFACT_NAME_HARD_FORBIDDEN = /[\\:<>|*?"]/;

// Encoding sequence for `/`. Reserved in `pkg.name` so the round-trip is
// unambiguous: `a/b` encodes to `a__b`, and `a__b` is rejected at config load.
const ENCODED_SLASH = '__';

/**
 * Encode a `[[package]].name` for use as an `actions/upload-artifact@v4`
 * artifact name component (or as a path segment under `artifacts/`).
 * Reverse mapping isn't needed at runtime — the publish-side readers
 * just `path.join` whatever the planner emitted.
 */
export function sanitizeArtifactName(name: string): string {
  return name.replaceAll('/', ENCODED_SLASH);
}

/* ------------------------------ schemas ------------------------------ */

const PILOT = z
  .object({
    version: z.literal(1),
  })
  .strict();

// Fields every package carries, regardless of kind.
const PACKAGE_BASE = {
  // #230: piot encodes `/` to `__` for artifact-name slots; other
  // upload-artifact-forbidden chars have no realistic identifier use,
  // so reject them at load time rather than encode them. The `__`
  // reservation keeps the slash round-trip unambiguous.
  name: z
    .string()
    .min(1)
    .refine((s) => !ARTIFACT_NAME_HARD_FORBIDDEN.test(s), {
      message:
        'package name must not contain \\, :, <, >, |, *, ?, or " (forbidden in actions/upload-artifact@v4 names; use only registry-safe characters)',
    })
    .refine((s) => !s.includes(ENCODED_SLASH), {
      message: `package name must not contain "${ENCODED_SLASH}" (reserved: piot encodes "/" to "${ENCODED_SLASH}" for artifact-name slots; pick a different separator)`,
    }),
  path: z.string().min(1),
  globs: z.array(z.string()).min(1),
  depends_on: z.array(z.string()).default([]),
  first_version: z.string().default('0.1.0'),
  // Template for the git tag cut on release. `{version}` is required;
  // `{name}` is optional (single-package repos can pick `"v{version}"`).
  // Default matches the historical shape the tool emitted before this
  // became configurable, so existing repos keep tagging unchanged.
  tag_format: z
    .string()
    .default(DEFAULT_TAG_FORMAT)
    .refine((s) => s.includes('{version}'), {
      message: 'tag_format must contain {version}',
    })
    .refine((s) => !/\{(?!name\}|version\})[^}]*\}/.test(s), {
      message:
        'tag_format contains an unknown placeholder (only {name} and {version} are allowed)',
    }),
};

// #217: opt-in "bundle a Rust CLI into every wheel" recipe. Declared
// under `[package.bundle_cli]` on pypi packages, only valid with
// `build = "maturin"`. Piot's scaffolded build job compiles the bin
// for each target and stages it into the package source tree so
// maturin includes it in each wheel. The `ruff` / `uv` /
// `pydantic-core` pattern, turned into a declarative shape. See
// docs/guide/shapes/polyglot-rust.md.
const BUNDLE_CLI = z
  .object({
    // `cargo build --bin <this>`. Required — the binary name is the
    // one thing piot can't infer.
    bin: z.string().min(1),
    // Destination path relative to `pkg.path`. Piot emits
    // `cp target/<triple>/release/<bin>[.exe] <pkg.path>/<stage_to>/`.
    // Maturin's `[tool.maturin].include` must cover this path so the
    // binary ends up inside each built wheel.
    stage_to: z.string().min(1),
    // Directory to run `cargo build` from. Defaults to repo root ("."),
    // which works for most workspace Cargo.toml layouts. Override when
    // the crate lives outside a workspace (e.g. `crates/my-tool`).
    crate_path: z.string().min(1).default('.'),
  })
  .strict();

// #159: `targets` entries can be a bare triple (uses the hardcoded
// runner mapping in src/plan.ts) or an object form that overrides the
// runner per target. `.strict()` on the object rejects unknown keys
// (typos like `runs_on` fail loudly rather than silently).
const TARGET_ENTRY = z.union([
  z.string(),
  z
    .object({
      triple: z.string(),
      runner: z.string().optional(),
    })
    .strict(),
]);

const CRATES_PKG = z
  .object({
    ...PACKAGE_BASE,
    kind: z.literal('crates'),
    crate: z.string().optional(),
    features: z.array(z.string()).optional(),
    no_default_features: z.boolean().optional(),
  })
  .strict();

const PYPI_BUILD = z.enum(['maturin', 'setuptools', 'hatch']);

const PYPI_PKG = z
  .object({
    ...PACKAGE_BASE,
    kind: z.literal('pypi'),
    pypi: z.string().optional(),
    // Default matches docs/guide/configuration.md. Consumers who pick a
    // different backend (maturin for Rust extensions, hatch) must opt in
    // explicitly.
    build: PYPI_BUILD.default('setuptools'),
    targets: z.array(TARGET_ENTRY).optional(),
    bundle_cli: BUNDLE_CLI.optional(),
  })
  .strict()
  .refine(
    (p) => p.targets === undefined || p.build === 'maturin',
    // §12.2: targets only for maturin on pypi.
    { message: 'targets is only valid when build = "maturin" on pypi packages' },
  )
  .refine(
    (p) => p.bundle_cli === undefined || p.build === 'maturin',
    // #217: bundle_cli stages a per-target Rust binary for maturin to
    // include in each wheel. The staging step assumes maturin on the
    // build side; setuptools/hatch can't pick it up.
    { message: 'bundle_cli is only valid when build = "maturin" on pypi packages' },
  )
  .refine(
    (p) => p.bundle_cli === undefined || (p.targets !== undefined && p.targets.length > 0),
    // #217: bundle_cli implies per-target wheel builds. A maturin pypi
    // without `targets` would produce only an sdist, and the staged
    // binary wouldn't end up in any wheel.
    { message: 'bundle_cli requires at least one entry in `targets`' },
  );

const NPM_BUILD = z.enum(['napi', 'bundled-cli']);

const NPM_PKG = z
  .object({
    ...PACKAGE_BASE,
    kind: z.literal('npm'),
    npm: z.string().optional(),
    access: z.enum(['public', 'restricted']).optional(),
    tag: z.string().optional(),
    build: NPM_BUILD.optional(),
    targets: z.array(TARGET_ENTRY).optional(),
  })
  .strict()
  .refine(
    (p) => p.targets === undefined || p.build === 'napi' || p.build === 'bundled-cli',
    // §12.2: targets only for napi or bundled-cli on npm.
    { message: 'targets is only valid when build = "napi" or "bundled-cli" on npm packages' },
  );

const PACKAGE = z.discriminatedUnion('kind', [CRATES_PKG, PYPI_PKG, NPM_PKG]);

const FILE = z
  .object({
    putitoutthere: PILOT,
    package: z.array(PACKAGE).min(1),
  })
  .strict();

/* --------------------------- public surface --------------------------- */

export type PilotBlock = z.infer<typeof PILOT>;
export type CratesPackage = z.infer<typeof CRATES_PKG>;
export type PypiPackage = z.infer<typeof PYPI_PKG>;
export type NpmPackage = z.infer<typeof NPM_PKG>;
export type Package = z.infer<typeof PACKAGE>;

export interface Config {
  putitoutthere: PilotBlock;
  packages: Package[];
}

/* ----------------------------- functions ----------------------------- */

export function parseConfig(toml: string): Config {
  let raw: unknown;
  try {
    raw = parseToml(toml);
    /* v8 ignore start -- smol-toml always throws Error; non-Error rethrow path is defensive */
  } catch (err) {
    throw new Error(`putitoutthere.toml: invalid TOML: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  /* v8 ignore stop */
  const result = FILE.safeParse(raw);
  if (!result.success) {
    throw new Error(`putitoutthere.toml: ${formatZodError(result.error)}`);
  }
  const parsed = result.data;
  assertUniqueNames(parsed.package);
  return {
    putitoutthere: parsed.putitoutthere,
    packages: parsed.package,
  };
}

export function loadConfig(path: string): Config {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
    /* v8 ignore start -- node's fs throws Error; non-Error rethrow is defensive */
  } catch (err) {
    throw new Error(
      `putitoutthere.toml: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  /* v8 ignore stop */
  return parseConfig(text);
}

/* ----------------------------- internals ----------------------------- */

function assertUniqueNames(packages: readonly Package[]): void {
  const seen = new Set<string>();
  for (const p of packages) {
    if (seen.has(p.name)) {
      throw new Error(`putitoutthere.toml: duplicate package name: ${p.name}`);
    }
    seen.add(p.name);
  }
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      /* v8 ignore next -- TOML always parses to an object root; '<root>' label can't fire */
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
