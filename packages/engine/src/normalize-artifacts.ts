/**
 * Single-artifact layout normalization (#311). `actions/download-artifact@v8`
 * is count-sensitive with `path:` and no `name`/`pattern`: multiple artifacts
 * get per-artifact subdirs, a *single* artifact extracts flat. Downstream
 * expects `artifacts/<artifact_name>/...`, so one-row plans would fail.
 */

import { mkdir, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from './utils/path-exists.js';
import type { MatrixRow } from './plan.js';

/**
 * Move dumped-into-root artifact files into the documented
 * `<artifactsRoot>/<artifact_name>/` subdir when the plan expects
 * exactly one staged artifact and the download step did not create
 * the subdir. No-op in every other case (multi-artifact, already
 * subdir-shaped, nothing downloaded, crates-only / vanilla-npm plans
 * that stage nothing).
 */
export async function normalizeArtifactLayout(
  matrix: readonly MatrixRow[],
  artifactsRoot: string,
): Promise<void> {
  // Only rows whose handler expects a staged artifact directory. crates
  // publishes from the source tree (no upload step in the build job);
  // vanilla npm packages the source on the publish runner. completeness
  // already short-circuits both kinds — see `src/completeness.ts`.
  const expected = matrix.filter(
    (r) => r.kind !== 'crates' && !(r.kind === 'npm' && r.target === 'noarch'),
  );
  if (expected.length !== 1) {return;}

  const row = expected[0]!;
  const targetDir = join(artifactsRoot, row.artifact_name);
  // Already in the documented layout — either a multi-artifact run
  // earlier in the same job, or a developer running locally with the
  // engine's contract honored. Either way, leave it alone.
  if (await pathExists(targetDir)) {return;}
  if (!(await pathExists(artifactsRoot))) {return;}

  const dumped = await readdir(artifactsRoot);
  if (dumped.length === 0) {return;}

  await mkdir(targetDir, { recursive: true });
  for (const entry of dumped) {
    await rename(join(artifactsRoot, entry), join(targetDir, entry));
  }
}
