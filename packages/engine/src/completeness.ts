/**
 * Artifact completeness check (#13, plan.md §13.2). Before any publish side
 * effect, verify every matrix row's artifact is present and shaped as
 * expected; a missing artifact aborts that package's release while other
 * packages continue. No `--allow-incomplete` flag: partial ships are the bug.
 */

import type { Kind } from './types.js';
import { verifyRow } from './verify-row.js';

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
