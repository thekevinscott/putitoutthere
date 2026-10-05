/**
 * Verify each published per-triple npm tarball ships a synthesized binary, not
 * just metadata (#443): an empty artifact dir yields a `package.json`-only
 * tarball and `npm publish` still returns 0. The count is RECURSIVE (#633) — a
 * nested `bin/<binary>` layout is legal to publish, and a flat count misses it.
 */

import { rm } from 'node:fs/promises';
import { relative } from 'node:path';

import { downloadNpmTarball } from './download.js';
import { listFilesRecursive } from '../../utils/list-files-recursive.js';
import { resolveNpmTarballUrl } from './resolve-url.js';
import { toPosixPath } from '../../utils/to-posix-path.js';
import type { TarballRow, VerifyNpmTarballOptions } from './types.js';

export async function verifyNpmTarballTriple(
  rows: TarballRow[],
  opts: VerifyNpmTarballOptions,
): Promise<number> {
  const npmRows = rows.filter((r) => r.kind === 'npm' && r.target !== 'main' && r.target !== 'noarch');
  if (npmRows.length === 0) {
    process.stdout.write('No npm per-triple rows; nothing to verify.\n');
    return 0;
  }

  const registry = opts.registry;
  let fail = 0;
  for (const row of npmRows) {
    const platformName = `${row.name}-${row.target}`;
    const version = row.version;
    process.stdout.write(`[${platformName}@${version}] verifying tarball at ${registry}\n`);

    const resolved = await resolveNpmTarballUrl(platformName, version, registry);
    if (resolved.status === 'failed') {
      // The resolve says what the registry answered; only this caller knows
      // the name it asked about is synthesized and could be wrong.
      process.stdout.write(
        `::error::[${platformName}@${version}] ${resolved.reason} Either the platform publish didn't actually publish, or the synthesized name diverged from the default {name}-{triple} template.\n`,
      );
      fail = 1;
      continue;
    }

    const { root, packageDir } = await downloadNpmTarball(resolved.url, 2);
    // Only the tarball's own root `package.json` is metadata — a nested one
    // is payload like any other file, and excluding it by basename would
    // make "contains only package.json" a false statement about a tarball
    // holding two of them.
    const payload = (await listFilesRecursive(packageDir))
      .map((f) => toPosixPath(relative(packageDir, f)))
      .filter((f) => f !== 'package.json');
    if (payload.length > 0) {
      process.stdout.write(`  ok: ${payload.length} non-metadata file(s): ${payload.join(' ')} \n`);
    } else {
      // No listing to print: reaching here means the recursive walk found
      // nothing but the root `package.json`, so any listing would restate
      // the sentence. The old message appended one built from a SECOND,
      // recursive walk while the verdict came from a top-level count — which
      // is how it came to name the very binary it called absent (#633).
      process.stdout.write(
        `::error::[${platformName}@${version}] tarball contains only package.json (no synthesized binary/.node staged).\n`,
      );
      fail = 1;
    }
    await rm(root, { recursive: true, force: true });
  }
  return fail;
}
