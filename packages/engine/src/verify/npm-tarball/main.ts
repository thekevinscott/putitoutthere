/**
 * Verify each published main/noarch npm tarball contains the directory
 * entries its `package.json` `files[]` declares (#443).
 *
 * The load-bearing check: the build job produces `dist/`, the publish job
 * ships from a fresh source tree, and `npm publish` returns 0 even when
 * that tree is missing the compiled output — so the registry receives a
 * tarball without `dist/` and nothing upstream complains. This step
 * downloads the published tarball back and asserts the declared dirs are
 * present and non-empty. Extracted verbatim from the "Verify published npm
 * tarballs honor package.json files" bash block.
 *
 * `files[]` entries without a dot are treated as directories (`dist`,
 * `lib`); dotted entries (`README.md`) are individual files and need no
 * per-tree assertion. Returns the process exit code (0 ok, 1 on any miss).
 */

import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { downloadNpmTarball } from './download.js';
import { listFilesRecursive } from '../../utils/list-files-recursive.js';
import { pathExists } from '../../utils/path-exists.js';
import { localDirState } from './local-dir-state.js';
import { resolveNpmTarballUrl } from './resolve-url.js';
import type { TarballRow, VerifyNpmTarballOptions } from './types.js';

export async function verifyNpmTarballMain(
  rows: TarballRow[],
  opts: VerifyNpmTarballOptions,
): Promise<number> {
  const npmRows = rows.filter((r) => r.kind === 'npm' && (r.target === 'main' || r.target === 'noarch'));
  if (npmRows.length === 0) {
    process.stdout.write('No npm main/noarch rows; nothing to verify.\n');
    return 0;
  }

  // Verdaccio (a same-host service container) is immediately consistent
  // once `npm publish` returns; real npm's CDN needs generous backoff.
  const registry = opts.registry;
  const sleeps = registry ? [1, 2, 5, 10] : [5, 15, 30, 90, 180];
  const registryLabel = registry ? registry : 'registry.npmjs.org';

  let fail = 0;
  for (const row of npmRows) {
    const pkgDirLocal = join(opts.cwd, row.path);
    const pkgJson = JSON.parse(await readFile(join(pkgDirLocal, 'package.json'), 'utf8')) as {
      name: string;
      files?: string[];
    };
    const pkgName = pkgJson.name;
    const version = row.version;
    const dirs = (pkgJson.files ?? []).filter((f) => !f.includes('.'));
    if (dirs.length === 0) {
      process.stdout.write(`[${pkgName}@${version}] no directory entries in files[]; skipping.\n`);
      continue;
    }
    process.stdout.write(
      `[${pkgName}@${version}] verifying tarball at ${registryLabel} contains: ${dirs.join(' ')}\n`,
    );

    const url = await resolveNpmTarballUrl(pkgName, version, { registry, sleeps });
    if (url === null) {
      process.stdout.write(
        `::error::[${pkgName}@${version}] npm view at ${registryLabel} never returned a tarball URL after ${sleeps.length + 1} attempts. Either the publish didn't actually publish, or packument propagation is much slower than expected.\n`,
      );
      fail = 1;
      continue;
    }

    const { root, packageDir } = await downloadNpmTarball(url, 5);
    for (const d of dirs) {
      const target = join(packageDir, d);
      // `-d` before counting: `listFilesRecursive` reads the dir, so it
      // must not run on a non-directory. The `&&` short-circuit mirrors
      // the bash `[ -d dir ] && [ "$(find … | wc -l)" -gt 0 ]`.
      if ((await pathExists(target)) && (await stat(target)).isDirectory() && (await listFilesRecursive(target)).length > 0) {
        const count = (await listFilesRecursive(target)).length;
        process.stdout.write(`  ok: package/${d}/ (${count} file(s))\n`);
      } else {
        process.stdout.write(
          `::error::[${pkgName}@${version}] tarball missing '${d}'. ${await localDirState(join(pkgDirLocal, d))}\n`,
        );
        fail = 1;
      }
    }
    await rm(root, { recursive: true, force: true });
  }
  return fail;
}
