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

/* ------------------------------ schemas ------------------------------ */

const PILOT = z
  .object({
    version: z.literal(1),
    cadence: z.enum(['immediate', 'scheduled']).optional(),
    agents_path: z.string().optional(),
  })
  .strict();

// Fields every package carries, regardless of kind.
const PACKAGE_BASE = {
  name: z.string().min(1),
  path: z.string().min(1),
  paths: z.array(z.string()).min(1),
  depends_on: z.array(z.string()).default([]),
  first_version: z.string().default('0.1.0'),
  smoke: z.string().optional(),
};

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
    build: PYPI_BUILD.optional(),
    wheels_artifact: z.string().optional(),
    targets: z.array(z.string()).optional(),
  })
  .strict()
  .refine(
    (p) => p.targets === undefined || p.build === 'maturin',
    // §12.2: targets only for maturin on pypi.
    { message: 'targets is only valid when build = "maturin" on pypi packages' },
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
    targets: z.array(z.string()).optional(),
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
