/**
 * Artifact completeness check.
 *
 * Before any publish side effect, verify every matrix row's artifact
 * is present and has the expected shape. A missing artifact aborts
 * that package's release (per plan.md §13.2); other packages
 * continue. No --allow-incomplete flag in v0: silent partial ships
 * are exactly the class of bug this exists to prevent.
 *
 * This is putitoutthere's own guardrail -- it runs regardless of what
 * the user's workflow YAML did with `needs:` chains or
 * `fail-fast: false`.
 *
 * Issue #13. Plan: §13.2.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from './utils/path-exists.js';
import { toPosixPath } from './utils/to-posix-path.js';
import type { Kind } from './types.js';

export interface MatrixRow {
  name: string;          // package name
  kind: Kind;
  version: string;
  target: string;        // triple | 'noarch' | 'sdist' | 'main'
  artifact_name: string; // deterministic, emitted by `pilot plan`
}

/**
 * Human-facing hint for where a row's artifact is expected to live.
 * Lives alongside error messages so users don't have to cross-reference
 * plan.md §12.4 to figure out the naming contract.
 */
export function expectedLayout(row: MatrixRow): string {
  const dir = `artifacts/${row.artifact_name}`;
  switch (row.kind) {
    case 'crates':
      return `${dir}/${row.name}-${row.version}.crate`;
    case 'pypi':
      if (row.target === 'sdist') {
        return `${dir}/${row.name}-${row.version}.tar.gz`;
      }
      return `${dir}/${row.name}-${row.version}-<python-tags>.whl`;
    case 'npm':
      if (row.target === 'main' || row.target === 'noarch') {
        return `${dir}/package.json`;
      }
      return `${dir}/<binary-or-bundle>`;
  }
}

export interface MissingArtifact {
  row: MatrixRow;
  reason: string;
}

export interface PackageCompleteness {
  ok: boolean;
  missing: MissingArtifact[];
}

export async function checkCompleteness(
  matrix: readonly MatrixRow[],
  artifactsRoot: string,
): Promise<Map<string, PackageCompleteness>> {
  const byPackage = new Map<string, PackageCompleteness>();

  for (const row of matrix) {
    const entry = byPackage.get(row.name) ?? { ok: true, missing: [] };
    const reason = await verifyRow(row, artifactsRoot);
    if (reason !== null) {
      entry.ok = false;
      entry.missing.push({ row, reason });
    }
    byPackage.set(row.name, entry);
  }

  return byPackage;
}

export async function requireCompleteness(
  matrix: readonly MatrixRow[],
  artifactsRoot: string,
): Promise<void> {
  const results = await checkCompleteness(matrix, artifactsRoot);
  const failed = [...results.entries()].filter(([, r]) => !r.ok);
  if (failed.length === 0) {return;}

  const lines: string[] = ['Artifact completeness check failed:'];
  for (const [pkg, result] of failed) {
    lines.push(`  ${pkg}:`);
    for (const m of result.missing) {
      lines.push(`    - target=${m.row.target} artifact=${m.row.artifact_name}: ${m.reason}`);
      lines.push(`      expected: ${expectedLayout(m.row)}`);
    }
  }
  lines.push('');
  lines.push('Naming contract: plan.md §12.4 (artifacts/{artifact_name}/).');
  lines.push('No side effects performed. Fix the build and re-run.');
  throw new Error(lines.join('\n'));
}

/* ----------------------------- internals ----------------------------- */

/**
 * Returns null when the row's artifact is present and shaped correctly;
 * otherwise a human-readable reason.
 */
async function verifyRow(row: MatrixRow, artifactsRoot: string): Promise<string | null> {
  // crates: `cargo publish` packages and uploads from the source tree
  // directly — the reusable workflow never uploads a `.crate` artifact
  // (release.yml's upload step is `if: matrix.kind != 'crates'`), so
  // there is nothing here to verify. Same logic as vanilla npm below.
  if (row.kind === 'crates') {return null;}
  // Vanilla npm publishes from the source tree directly; the build
  // step never produced a separate artifact for this kind, so there's
  // nothing to check here. Same goes for a missing artifactsRoot --
  // local `putitoutthere publish` runs (no CI download step) don't
  // have one.
  if (row.kind === 'npm' && row.target === 'noarch') {return null;}

  const dir = join(artifactsRoot, row.artifact_name);
  if (!(await pathExists(dir))) {
    return `missing artifact directory ${row.artifact_name}/`;
  }
  let files: string[];
  try {
    files = await listFiles(dir);
  } catch (err) {
    return `cannot read ${row.artifact_name}/: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (files.length === 0) {
    return `empty artifact directory ${row.artifact_name}/`;
  }
  return verifyShape(row, files);
}

/**
 * Recursive file listing. Wheels and sdists may sit one level deep in
 * a `dist/` subdir depending on how the user's build writes them.
 */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const st = await stat(full);
    if (st.isDirectory()) {
      out.push(...(await listFiles(full)));
    } else if (st.isFile() && st.size > 0) {
      // Normalize separators once, here at the listing boundary, so every
      // downstream trailing-name check is a single `/<name>` comparison
      // that holds on Windows and POSIX alike.
      out.push(toPosixPath(full));
    }
  }
  return out;
}

export function verifyShape(row: MatrixRow, files: string[]): string | null {
  switch (row.kind) {
    case 'crates':
      return hasSuffix(files, '.crate')
        ? null
        : `no .crate file in ${row.artifact_name}/`;
    case 'pypi':
      if (row.target === 'sdist') {
        return hasSuffix(files, '.tar.gz')
          ? null
          : `no .tar.gz (sdist) in ${row.artifact_name}/`;
      }
      return hasSuffix(files, '.whl')
        ? null
        : `no .whl file in ${row.artifact_name}/`;
    case 'npm':
      // vanilla (noarch) and `main` must have package.json. Per-platform
      // rows need any binary/bundle artifact to be meaningful; since
      // napi + bundled-cli layouts vary, a non-empty directory is
      // enough.
      if (row.target === 'main' || row.target === 'noarch') {
        return hasFile(files, 'package.json')
          ? null
          : `no package.json in ${row.artifact_name}/`;
      }
      return null; // any non-empty file is acceptable for a platform package
  }
}

function hasSuffix(files: readonly string[], suffix: string): boolean {
  return files.some((f) => f.endsWith(suffix));
}

function hasFile(files: readonly string[], name: string): boolean {
  // Paths are normalized to `/` at the listing boundary (see `listFiles`),
  // so a single-separator trailing-name match is enough on every OS.
  return files.some((f) => f.endsWith(`/${name}`));
}
