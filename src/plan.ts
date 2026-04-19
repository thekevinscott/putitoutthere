/**
 * `putitoutthere plan` — the planner.
 *
 * Composes config, trailer, cascade, version, git into the matrix-row
 * array consumed by the GHA `build` job. Per plan.md §12.4. Pure
 * function over (config + git state) → matrix; deterministic for the
 * same inputs so CI golden-file checks have something to compare.
 *
 * Issue #21.
 */

import { join } from 'node:path';

import { computeCascade } from './cascade.js';
import { loadConfig, type Package } from './config.js';
import { commitBody, diffNames, headCommit, lastTag } from './git.js';
import type { Bump, Kind } from './types.js';
import { parseTrailer } from './trailer.js';
import { bump as bumpVersion, firstVersion } from './version.js';

export interface MatrixRow {
  name: string;
  kind: Kind;
  version: string;
  target: string;        // 'noarch' | 'sdist' | 'main' | <triple>
  runs_on: string;
  artifact_name: string;
  artifact_path: string;
  path: string;          // package working dir
  build?: string;        // handler-specific build mode
}

export interface PlanOptions {
  cwd: string;
  configPath?: string;   // defaults to `${cwd}/putitoutthere.toml`
}

export function plan(opts: PlanOptions): Promise<MatrixRow[]> {
  const cwd = opts.cwd;
  const cfgPath = opts.configPath ?? join(cwd, 'putitoutthere.toml');
  const config = loadConfig(cfgPath);

  // What changed since the last release per package?
  const head = headCommit({ cwd });
  const trailer = parseTrailer(commitBody(head, { cwd }));

  if (trailer?.bump === 'skip') {
    return Promise.resolve([]);
  }

  // Compute cascade. For each package with a last tag, diff against
  // that tag. Packages without a last tag are first-release: force-
  // cascade without globbing (avoids walking the working tree).
  const { changes, firstRelease } = collectChanges(config.packages, cwd);
  const cascaded = new Set(
    computeCascade(config.packages, changes).map((p) => p.name),
  );
  for (const name of firstRelease) cascaded.add(name);

  // Trailer can additionally force-include packages by name.
  const forced = new Set(trailer?.packages ?? []);
  for (const name of forced) cascaded.add(name);

  if (cascaded.size === 0) return Promise.resolve([]);

  const rows: MatrixRow[] = [];
  for (const p of config.packages) {
    if (!cascaded.has(p.name)) continue;
    const version = nextVersion(p, trailer?.bump, cwd, forced);
    rows.push(...rowsForPackage(p, version));
  }
  return Promise.resolve(rows);
}

/* ----------------------------- internals ----------------------------- */

function collectChanges(
  packages: readonly Package[],
  cwd: string,
): { changes: string[]; firstRelease: ReadonlySet<string> } {
  const changes = new Set<string>();
  const firstRelease = new Set<string>();
  for (const p of packages) {
    const tag = lastTag(p.name, { cwd });
    if (tag === null) {
      firstRelease.add(p.name);
    } else {
      for (const f of diffNames(tag, 'HEAD', { cwd })) changes.add(f);
    }
  }
  return { changes: [...changes], firstRelease };
}

function nextVersion(
  pkg: Package,
  trailerBump: Bump | 'skip' | undefined,
  cwd: string,
  trailerPackages: ReadonlySet<string>,
): string {
  const tag = lastTag(pkg.name, { cwd });
  if (tag === null) {
    return firstVersion(pkg);
  }
  const lastVersion = tag.replace(`${pkg.name}-v`, '');

  // Trailer bump applies to every cascaded package, OR specifically to
  // packages listed in [trailer.packages]. If the trailer scoped the
  // list, only listed packages get the trailer's bump; unlisted
  // cascaded packages still go at default patch.
  const wantsBump =
    trailerBump !== undefined &&
    trailerBump !== 'skip' &&
    (trailerPackages.size === 0 || trailerPackages.has(pkg.name));

  const bumpType: Bump = wantsBump ? trailerBump : 'patch';
  return bumpVersion(lastVersion, bumpType);
}

function rowsForPackage(pkg: Package, version: string): MatrixRow[] {
  switch (pkg.kind) {
    case 'crates':
      return [
        {
          name: pkg.name,
          kind: 'crates',
          version,
          target: 'noarch',
          runs_on: 'ubuntu-latest',
          artifact_name: `${pkg.name}-crate`,
          artifact_path: `${pkg.path}/target/package/*.crate`,
          path: pkg.path,
        },
      ];

    case 'pypi': {
      const build = (pkg as { build?: string }).build;
      const targets = (pkg as { targets?: string[] }).targets ?? [];
      const out: MatrixRow[] = [];
      if (build === 'maturin' && targets.length > 0) {
        for (const t of targets) {
          out.push({
            name: pkg.name,
            kind: 'pypi',
            version,
            target: t,
            runs_on: defaultRunsOn(t),
            artifact_name: `${pkg.name}-wheel-${t}`,
            artifact_path: `${pkg.path}/dist/*.whl`,
            path: pkg.path,
            build,
          });
        }
      }
      // Always emit an sdist row for pypi.
      out.push({
        name: pkg.name,
        kind: 'pypi',
        version,
        target: 'sdist',
        runs_on: 'ubuntu-latest',
        artifact_name: `${pkg.name}-sdist`,
        artifact_path: `${pkg.path}/dist/*.tar.gz`,
        path: pkg.path,
        ...(build !== undefined ? { build } : {}),
      });
      return out;
    }

    case 'npm': {
      const build = (pkg as { build?: string }).build;
      const targets = (pkg as { targets?: string[] }).targets ?? [];
      if (build === 'napi' || build === 'bundled-cli') {
        const out: MatrixRow[] = [];
        for (const t of targets) {
          out.push({
            name: pkg.name,
            kind: 'npm',
            version,
            target: t,
            runs_on: defaultRunsOn(t),
            artifact_name: `${pkg.name}-${t}`,
            artifact_path: `${pkg.path}/build/${t}`,
            path: pkg.path,
            build,
          });
        }
        // Plus the main package row.
        out.push({
          name: pkg.name,
          kind: 'npm',
          version,
          target: 'main',
          runs_on: 'ubuntu-latest',
          artifact_name: `${pkg.name}-main`,
          artifact_path: pkg.path,
          path: pkg.path,
          build,
        });
        return out;
      }
      // Vanilla mode: single noarch row.
      return [
        {
          name: pkg.name,
          kind: 'npm',
          version,
          target: 'noarch',
          runs_on: 'ubuntu-latest',
          artifact_name: `${pkg.name}-pkg`,
          artifact_path: pkg.path,
          path: pkg.path,
          ...(build !== undefined ? { build } : {}),
        },
      ];
    }
  }
}

/**
 * Per-target default GHA runner. Native runners where available, else
 * cross-compile on ubuntu. Plan §12.3 calls these out as "opinionated
 * defaults; user can override".
 */
function defaultRunsOn(target: string): string {
  if (target.includes('apple-darwin') || target.includes('darwin') || target.includes('mac')) {
    return 'macos-latest';
  }
  if (target.includes('windows') || target.includes('win32') || target.includes('msvc')) {
    return 'windows-latest';
  }
  if (target.includes('aarch64-unknown-linux') || target.includes('aarch64-linux')) {
    // Native arm runners are free for public repos.
    return 'ubuntu-24.04-arm';
  }
  return 'ubuntu-latest';
}
