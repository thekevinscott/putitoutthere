/**
 * Verify each published per-triple npm tarball ships a synthesized binary,
 * not just metadata (#443).
 *
 * `npm-platform`'s `synthesizePlatformPackage` emits `files: <readdir of
 * the artifact dir>`, so an empty artifact dir yields a tarball with only
 * `package.json` and `npm publish` still returns 0. This step downloads the
 * published platform tarball back and asserts at least one non-`package.json`
 * file is present — shipping that binary is the whole point of the
 * synthesis. Extracted verbatim from the "Verify published per-triple npm
 * tarballs honor expected files" bash block.
 *
 * The platform package name is reconstructed as `{name}-{triple}` — the
 * default template every fixture uses — because the matrix row carries the
 * main package name (synthesis is a publish-time concern). Returns the
 * process exit code (0 ok, 1 on any metadata-only tarball).
 */

import { readdirSync, rmSync } from 'node:fs';

import { downloadNpmTarball } from './download.js';
import { listFilesRecursive } from '../../utils/list-files-recursive.js';
import { resolveNpmTarballUrl } from './resolve-url.js';
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

    const url = await resolveNpmTarballUrl(platformName, version, { registry, sleeps: [2, 2, 2, 2] });
    if (url === null) {
      process.stdout.write(
        `::error::[${platformName}@${version}] npm view at ${registry} never returned a tarball URL. Either the platform publish didn't actually publish, or the synthesized name diverged from the default {name}-{triple} template.\n`,
      );
      fail = 1;
      continue;
    }

    const { root, packageDir } = downloadNpmTarball(url, 2);
    const topLevel = readdirSync(packageDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name !== 'package.json')
      .map((e) => e.name);
    if (topLevel.length > 0) {
      process.stdout.write(`  ok: ${topLevel.length} non-metadata file(s): ${topLevel.join(' ')} \n`);
    } else {
      const listing = listFilesRecursive(packageDir).map((p) => p.split('/').pop()).join(' ');
      process.stdout.write(
        `::error::[${platformName}@${version}] tarball contains only package.json (no synthesized binary/.node staged). Tarball contents: ${listing} \n`,
      );
      fail = 1;
    }
    rmSync(root, { recursive: true, force: true });
  }
  return fail;
}
