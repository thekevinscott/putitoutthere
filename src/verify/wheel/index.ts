/**
 * `putitoutthere verify wheel` — assert the built wheel/sdist carries the
 * planned version (#450, epic #442).
 *
 * Extraction of the inline "Verify wheel/sdist version matches
 * matrix.version" bash block (#276) in `.github/workflows/e2e-fixture-job.yml`.
 * The contract, per that step: "the build artifact carries matrix.version",
 * verified directly against the produced files — independent of which
 * mechanism (write-version, SETUPTOOLS_SCM_PRETEND_VERSION, …) set the
 * manifest, so it catches a divergence regardless of which build path
 * silently regressed.
 *
 * For an sdist row (`--target sdist`) the sdist filename must end
 * `-<version>.tar.gz`; for a wheel row the first `*.whl`'s
 * `*.dist-info/METADATA` `Version:` must equal `--version`. The wheel is
 * read with a pure-Node zip reader (no `unzip`), so this runs on every
 * platform the maturin matrix builds on. Synchronous throughout. Returns the
 * process exit code (0 ok, 1 on any miss).
 */

import { existsSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

import { findDistFile } from './find-dist-file.js';
import { readWheelVersion } from './read-wheel-version.js';
import type { VerifyWheelOptions } from './types.js';

export function verifyWheel(opts: VerifyWheelOptions): number {
  const pkgDir = isAbsolute(opts.path) ? opts.path : resolve(opts.cwd, opts.path);
  const distDir = join(pkgDir, 'dist');
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    process.stdout.write(`::error::no dist/ produced under ${distDir}\n`);
    return 1;
  }

  if (opts.target === 'sdist') {
    const sdist = findDistFile(distDir, '.tar.gz');
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

  const wheel = findDistFile(distDir, '.whl');
  if (wheel === null) {
    process.stdout.write(`::error::no wheel produced in ${distDir}\n`);
    return 1;
  }
  const actual = readWheelVersion(wheel);
  if (actual !== opts.version) {
    process.stdout.write(
      `::error::wheel METADATA Version='${actual ?? ''}' but plan='${opts.version}' (wheel: ${basename(wheel)})\n`,
    );
    return 1;
  }
  process.stdout.write(`ok wheel: ${basename(wheel)} METADATA Version=${actual}\n`);
  return 0;
}
