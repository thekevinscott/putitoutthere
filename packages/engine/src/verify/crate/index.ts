/**
 * `putitoutthere verify crate` — assert each published `.crate` ships its
 * source tree (#449, epic #442).
 *
 * Extraction of the inline "Verify published .crate tarballs honor expected
 * files" bash block (#334) in `.github/workflows/e2e-fixture-job.yml`. The
 * crates-side sibling of `verify npm-tarball` (#443): where npm downloads
 * the tarball over HTTP, crates reads the `.crate` straight off the
 * `cargo-http-registry` disk root the engine just published to — same host,
 * same job, no fetch. For each crates row it finds `<name>-<version>.crate`
 * under the registry root, asserts it is present and non-empty, extracts it
 * with the real `tar`, and asserts `src/lib.rs` or `src/main.rs` surfaces.
 *
 * The diagnostic this gate gives (the rust-vanilla-first-publish fixture):
 * without it, a publish that silently no-op'd or produced an empty `.crate`
 * would still go green. Synchronous throughout, per the engine convention.
 * Returns the process exit code (0 ok, 1 on any miss).
 */

import { rmSync } from 'node:fs';

import { extractCrate } from './extract-crate.js';
import { findCrateFile } from './find-crate-file.js';
import { hasCrateSource } from './has-crate-source.js';
import { listFilesRecursive } from '../../utils/list-files-recursive.js';
import type { CrateRow, VerifyCrateOptions } from './types.js';

export function verifyCrate(opts: VerifyCrateOptions): number {
  const rows = (JSON.parse(opts.matrix) as CrateRow[]).filter((r) => r.kind === 'crates');
  if (rows.length === 0) {
    process.stdout.write('No crates rows; nothing to verify.\n');
    return 0;
  }

  let fail = 0;
  for (const row of rows) {
    const crateFile = findCrateFile(opts.registryRoot, row.name, row.version);
    if (crateFile === null) {
      process.stdout.write(
        `::error::[${row.name}@${row.version}] no .crate file found (or empty) under ${opts.registryRoot}\n`,
      );
      fail = 1;
      continue;
    }

    const extracted = extractCrate(crateFile);
    if (hasCrateSource(extracted)) {
      process.stdout.write(`ok: ${crateFile} contains src/lib.rs or src/main.rs\n`);
    } else {
      const listing = listFilesRecursive(extracted).join(' ');
      process.stdout.write(
        `::error::[${row.name}@${row.version}] .crate tarball missing src/lib.rs and src/main.rs. Tarball contents: ${listing}\n`,
      );
      fail = 1;
    }
    rmSync(extracted, { recursive: true, force: true });
  }
  return fail;
}
