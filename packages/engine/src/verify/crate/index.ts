/**
 * `putitoutthere verify crate` — assert each published `.crate` ships its source
 * tree (#449, #334): read it off the `cargo-http-registry` disk root just
 * published to (no fetch, unlike `verify npm-tarball`, #443), extract with real
 * `tar`, assert `src/lib.rs` or `src/main.rs`. An empty `.crate` would go green.
 */

import { rm } from 'node:fs/promises';

import { extractCrate } from './extract-crate.js';
import { findCrateFile } from './find-crate-file.js';
import { hasCrateSource } from './has-crate-source.js';
import { listFilesRecursive } from '../../utils/list-files-recursive.js';
import type { CrateRow, VerifyCrateOptions } from './types.js';

export async function verifyCrate(opts: VerifyCrateOptions): Promise<number> {
  const rows = (JSON.parse(opts.matrix) as CrateRow[]).filter((r) => r.kind === 'crates');
  if (rows.length === 0) {
    process.stdout.write('No crates rows; nothing to verify.\n');
    return 0;
  }

  let fail = 0;
  for (const row of rows) {
    const crateFile = await findCrateFile(opts.registryRoot, row.name, row.version);
    if (crateFile === null) {
      process.stdout.write(
        `::error::[${row.name}@${row.version}] no .crate file found (or empty) under ${opts.registryRoot}\n`,
      );
      fail = 1;
      continue;
    }

    const extracted = await extractCrate(crateFile);
    if (await hasCrateSource(extracted)) {
      process.stdout.write(`ok: ${crateFile} contains src/lib.rs or src/main.rs\n`);
    } else {
      const listing = (await listFilesRecursive(extracted)).join(' ');
      process.stdout.write(
        `::error::[${row.name}@${row.version}] .crate tarball missing src/lib.rs and src/main.rs. Tarball contents: ${listing}\n`,
      );
      fail = 1;
    }
    await rm(extracted, { recursive: true, force: true });
  }
  return fail;
}
