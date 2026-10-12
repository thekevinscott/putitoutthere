import { join } from 'node:path';
import type { MatrixRow } from './completeness.js';
import { listFiles } from './list-files.js';
import { pathExists } from './utils/path-exists.js';
import { verifyShape } from './verify-shape.js';

/**
 * Returns null when the row's artifact is present and shaped correctly;
 * otherwise a human-readable reason.
 */
export async function verifyRow(row: MatrixRow, artifactsRoot: string): Promise<string | null> {
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
