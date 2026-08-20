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
 * The count is RECURSIVE (#633). A consumer whose build stages the binary
 * nested — `artifacts/<name>-<triple>/bin/<binary>` rather than flat —
 * publishes a tarball whose top level is `package.json` plus the `bin/`
 * directory, and a top-level file count discards that directory along with
 * the payload inside it. The nested layout is legal all the way to publish
 * (`checkCompleteness` lists recursively, so it accepts either shape), so
 * this check has to see it too. Paths are reported relative to `package/`,
 * which is what makes a nested payload legible in the log.
 *
 * The platform package name is reconstructed as `{name}-{triple}` — the
 * default template every fixture uses — because the matrix row carries the
 * main package name (synthesis is a publish-time concern). Returns the
 * process exit code (0 ok, 1 on any metadata-only tarball).
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

    const url = await resolveNpmTarballUrl(platformName, version, { registry, sleeps: [2, 2, 2, 2] });
    if (url === null) {
      process.stdout.write(
        `::error::[${platformName}@${version}] npm view at ${registry} never returned a tarball URL. Either the platform publish didn't actually publish, or the synthesized name diverged from the default {name}-{triple} template.\n`,
      );
      fail = 1;
      continue;
    }

    const { root, packageDir } = await downloadNpmTarball(url, 2);
    // One listing feeds both arms, so the diagnostic can no longer contradict
    // the verdict by naming a file the count didn't see. Only the tarball's
    // own `package.json` is metadata — a nested one is payload like any other
    // file, and excluding it by basename would make "contains only
    // package.json" a false statement about a tarball holding two files.
    const contents = (await listFilesRecursive(packageDir)).map((f) =>
      toPosixPath(relative(packageDir, f)),
    );
    const payload = contents.filter((f) => f !== 'package.json');
    if (payload.length > 0) {
      process.stdout.write(`  ok: ${payload.length} non-metadata file(s): ${payload.join(' ')} \n`);
    } else {
      process.stdout.write(
        `::error::[${platformName}@${version}] tarball contains only package.json (no synthesized binary/.node staged). Tarball contents: ${contents.join(' ')} \n`,
      );
      fail = 1;
    }
    await rm(root, { recursive: true, force: true });
  }
  return fail;
}
