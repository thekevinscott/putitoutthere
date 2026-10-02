/**
 * `putitoutthere verify bundle-cli` — assert a maturin bundled-CLI wheel ships
 * its cross-compiled binary at `<stage_suffix>/<bin><ext>` (`.exe` on Windows)
 * (#451, #282/#358): without it a build that failed to stage the binary still
 * produces a wheel and goes green. Zip reads use `verify wheel`'s reader (#450).
 */

import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';

import { findDistFile } from '../wheel/find-dist-file.js';
import { readZipEntry } from '../wheel/read-zip-entry.js';
import { computeStageSuffix } from './compute-stage-suffix.js';
import { readPythonSource } from './read-python-source.js';
import type { VerifyBundleCliOptions } from './types.js';

export async function verifyBundleCli(opts: VerifyBundleCliOptions): Promise<number> {
  const pkgDir = isAbsolute(opts.path) ? opts.path : resolve(opts.cwd, opts.path);
  const distDir = join(pkgDir, 'dist');
  const wheel = await findDistFile(distDir, '.whl');
  if (wheel === null) {
    process.stdout.write(`::error::no wheel produced under ${distDir}\n`);
    return 1;
  }

  const stageSuffix = computeStageSuffix(opts.stageTo, await readPythonSource(pkgDir));
  const ext = opts.target.includes('windows') ? '.exe' : '';
  const expected = `${opts.bin}${ext}`;
  const suffix = `${stageSuffix}/${expected}`;

  // The bash `unzip -l | awk '{print $NF}' | grep -qE "(^|/)…$"` over the
  // wheel's entry names. The bash regex only ever anchors a fixed path suffix
  // (`stage_suffix`/`bin` are literal paths, never patterns), so match it as
  // a literal: `(^|/)<suffix>$` holds exactly when the entry is `<suffix>` or
  // ends with `/<suffix>`, i.e. `"/"+name` ends with `"/"+suffix`. Building a
  // RegExp from the interpolated path would both mis-handle a `.`/`+` in a
  // real path and open a regex-injection seam (CodeQL) for zero benefit.
  // `readZipEntry` visits entries until one matches, so the matcher doubles
  // as the "wheel contents" collector: on a miss it has walked (and recorded)
  // every name for the diagnostic listing the bash dumps with `unzip -l`; on
  // a hit it short-circuits, and the listing is not needed.
  const entries: string[] = [];
  const present = readZipEntry(await readFile(wheel), (name) => {
    entries.push(name);
    return `/${name}`.endsWith(`/${suffix}`);
  }) !== null;

  const base = basename(wheel);
  if (!present) {
    process.stdout.write(
      `::error::wheel ${base} missing bundle_cli binary at ${suffix}\n`,
    );
    process.stdout.write('wheel contents:\n');
    for (const name of entries) {
      process.stdout.write(`${name}\n`);
    }
    return 1;
  }
  process.stdout.write(`ok bundle_cli: ${suffix} present in ${base}\n`);
  return 0;
}
