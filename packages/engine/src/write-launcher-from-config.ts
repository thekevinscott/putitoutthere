import { isAbsolute, join, resolve } from 'node:path';

import type { NpmPackage } from './config.js';
import { loadConfig } from './load-config.js';
import { normalizeBuild } from './handlers/npm-platform.js';
import { writeLauncher } from './write-launcher.js';

export interface WriteLauncherFromConfigOptions {
  /** Repo root — `${cwd}/putitoutthere.toml` is read to locate the package. */
  cwd: string;
  /** Package directory relative to `cwd` (or absolute). Matches against
   *  the config's `pkg.path`. */
  packagePath: string;
  /** Optional config path override (mirrors the global CLI flag). */
  configPath?: string;
}

export async function writeLauncherFromConfig(
  opts: WriteLauncherFromConfigOptions,
): Promise<string[]> {
  const cfg = await loadConfig(opts.configPath ?? join(opts.cwd, 'putitoutthere.toml'));
  const absPkg = isAbsolute(opts.packagePath)
    ? opts.packagePath
    : resolve(opts.cwd, opts.packagePath);
  const pkg = cfg.packages.find(
    (p) => resolve(opts.cwd, p.path) === absPkg,
  );
  if (!pkg) {
    throw new Error(
      `write-launcher: no [[package]] entry with path "${opts.packagePath}" in ${opts.configPath ?? join(opts.cwd, 'putitoutthere.toml')}`,
    );
  }
  if (pkg.kind !== 'npm') {return [];}

  const npmPkg: NpmPackage = pkg;
  const buildEntries = normalizeBuild(npmPkg.build);
  const bundledCli = buildEntries.find((e) => e.mode === 'bundled-cli');
  if (!bundledCli) {return [];}
  // `[package.bundle_cli]` is optional (#298). Absent ⇒ the consumer's legacy
  // "bring your own bin/<bin>.js" path, so no-op. The gate lives here, not in
  // the workflow: the main row never carries `bundle_cli` (plan.ts attaches it
  // to per-target rows only), and #299 crashed every legacy main row without it.
  const bundleCli = npmPkg.bundle_cli;
  if (bundleCli === undefined) {return [];}
  // bundle_cli present ⇒ `targets` is non-empty (config.ts refinement), so
  // the assertion is sound on this path.
  const targets = npmPkg.targets!;
  const triples = targets.map((t) => (typeof t === 'string' ? t : t.triple));
  const npmName = npmPkg.npm ?? npmPkg.name;
  return await writeLauncher({
    pkgDir: resolve(opts.cwd, npmPkg.path),
    npmName,
    bin: bundleCli.bin,
    platformNameTemplate: bundledCli.name,
    triples,
  });
}
