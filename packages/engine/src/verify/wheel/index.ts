/**
 * `putitoutthere verify wheel` — assert the built wheel/sdist carries the planned
 * version (#450, #276), whatever set the manifest. An sdist filename must end
 * `-<version>.tar.gz`; a wheel's `*.dist-info/METADATA` `Version:` must equal
 * `--version`, read with a pure-Node zip reader so Windows rows work too.
 */

import { stat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';

import { findDistFile } from './find-dist-file.js';
import { manylinuxTagPatterns } from './manylinux-tag-patterns.js';
import { readWheelVersion } from './read-wheel-version.js';
import { pathExists } from '../../utils/path-exists.js';
import type { VerifyWheelOptions } from './types.js';

export async function verifyWheel(opts: VerifyWheelOptions): Promise<number> {
  const pkgDir = isAbsolute(opts.path) ? opts.path : resolve(opts.cwd, opts.path);
  const distDir = join(pkgDir, 'dist');
  if (!(await pathExists(distDir)) || !(await stat(distDir)).isDirectory()) {
    process.stdout.write(`::error::no dist/ produced under ${distDir}\n`);
    return 1;
  }

  if (opts.target === 'sdist') {
    const sdist = await findDistFile(distDir, '.tar.gz');
    if (sdist === null) {
      process.stdout.write(`::error::no sdist produced in ${distDir}\n`);
      return 1;
    }
    const name = basename(sdist);
    if (name.endsWith(`-${opts.version}.tar.gz`)) {
      process.stdout.write(`ok sdist: ${name}\n`);
      return 0;
    }
    process.stdout.write(
      `::error::sdist filename '${name}' does not contain planned version '${opts.version}'\n`,
    );
    return 1;
  }

  const wheel = await findDistFile(distDir, '.whl');
  if (wheel === null) {
    process.stdout.write(`::error::no wheel produced in ${distDir}\n`);
    return 1;
  }
  const actual = await readWheelVersion(wheel);
  if (actual !== opts.version) {
    process.stdout.write(
      `::error::wheel METADATA Version='${actual ?? ''}' but plan='${opts.version}' (wheel: ${basename(wheel)})\n`,
    );
    return 1;
  }
  // #610: when the row carries a manylinux baseline, the produced
  // wheel's filename must carry the matching platform tag — this is
  // exactly the regression dirsql#818 shipped (host-glibc-tagged
  // wheels), so verify it against the artifact, not the build config.
  const patterns = manylinuxTagPatterns(opts.manylinux);
  if (patterns.length > 0 && !patterns.some((p) => basename(wheel).includes(p))) {
    process.stdout.write(
      `::error::wheel '${basename(wheel)}' does not carry the requested manylinux baseline '${opts.manylinux ?? ''}' (expected a platform tag containing ${patterns.map((p) => `'${p}'`).join(' or ')})\n`,
    );
    return 1;
  }
  process.stdout.write(`ok wheel: ${basename(wheel)} METADATA Version=${actual}\n`);
  return 0;
}
