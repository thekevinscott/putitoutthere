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

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Kind } from './types.js';

export interface MatrixRow {
  name: string;          // package name
  kind: Kind;
  version: string;
  target: string;        // triple | 'noarch' | 'sdist' | 'main'
  artifact_name: string; // deterministic, emitted by `pilot plan`
}

export interface MissingArtifact {
  row: MatrixRow;
  reason: string;
}

export interface PackageCompleteness {
  ok: boolean;
  missing: MissingArtifact[];
}

export function checkCompleteness(
  matrix: readonly MatrixRow[],
  artifactsRoot: string,
): Map<string, PackageCompleteness> {
  const byPackage = new Map<string, PackageCompleteness>();

  for (const row of matrix) {
    const entry = byPackage.get(row.name) ?? { ok: true, missing: [] };
    const reason = verifyRow(row, artifactsRoot);
    if (reason !== null) {
      entry.ok = false;
      entry.missing.push({ row, reason });
    }
    byPackage.set(row.name, entry);
  }

  return byPackage;
}

export function requireCompleteness(
  matrix: readonly MatrixRow[],
  artifactsRoot: string,
): void {
  const results = checkCompleteness(matrix, artifactsRoot);
  const failed = [...results.entries()].filter(([, r]) => !r.ok);
  if (failed.length === 0) return;

  const lines: string[] = ['Artifact completeness check failed:'];
  for (const [pkg, result] of failed) {
    lines.push(`  ${pkg}:`);
    for (const m of result.missing) {
      lines.push(`    - target=${m.row.target} artifact=${m.row.artifact_name}: ${m.reason}`);
    }
  }
  lines.push('');
  lines.push('No side effects performed. Fix the build and re-run.');
  throw new Error(lines.join('\n'));
}

/* ----------------------------- internals ----------------------------- */

/**
 * Returns null when the row's artifact is present and shaped correctly;
 * otherwise a human-readable reason.
 */
function verifyRow(row: MatrixRow, artifactsRoot: string): string | null {
  const dir = join(artifactsRoot, row.artifact_name);
  if (!existsSync(dir)) {
    return `missing artifact directory ${row.artifact_name}/`;
  }
  let files: string[];
  try {
    files = listFiles(dir);
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
function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFiles(full));
    } else if (st.isFile() && st.size > 0) {
      out.push(full);
    }
  }
  return out;
}

function verifyShape(row: MatrixRow, files: string[]): string | null {
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
  return files.some((f) => f.endsWith(`/${name}`) || f.endsWith(`\\${name}`));
}
