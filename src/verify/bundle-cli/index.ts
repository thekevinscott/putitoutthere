/**
 * `putitoutthere verify bundle-cli` — assert a maturin bundled-CLI wheel
 * contains its cross-compiled binary at `<stage_to>/<bin>` (#451, epic #442).
 *
 * Extraction of the inline "bundle_cli — verify wheel contains
 * <stage_to>/<bin>" bash block in `.github/workflows/_matrix.yml`. That step
 * guards the #282/#358 contract: a `[package.bundle_cli]` build must stage
 * its per-target binary into the wheel, so a consumer who declares a bundled
 * CLI actually ships one. Without it, a build that silently failed to stage
 * the binary would still produce a wheel and go green — the release surprise
 * the no-surprises commitment exists to catch.
 *
 * The binary's expected path is `<stage_suffix>/<bin><ext>` where
 * `stage_suffix` is `stage_to` with `[tool.maturin].python-source`
 * subtracted (maturin strips that dir from the wheel layout) and `ext` is
 * `.exe` on a Windows target. The wheel is a zip; its entries are read with
 * the pure-Node reader `verify wheel` (#450) already ships — no `unzip`, so
 * this runs on every platform the maturin matrix builds on, Windows
 * included — and the match mirrors the bash `grep -qE
 * "(^|/)<stage_suffix>/<expected>$"`. Synchronous throughout. Returns the
 * process exit code (0 ok, 1 on a miss).
 */

import { readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

import { findDistFile } from '../wheel/find-dist-file.js';
import { readZipEntry } from '../wheel/read-zip-entry.js';
import { computeStageSuffix } from './compute-stage-suffix.js';
import { readPythonSource } from './read-python-source.js';
import type { VerifyBundleCliOptions } from './types.js';

export function verifyBundleCli(opts: VerifyBundleCliOptions): number {
  const pkgDir = isAbsolute(opts.path) ? opts.path : resolve(opts.cwd, opts.path);
  const distDir = join(pkgDir, 'dist');
  const wheel = findDistFile(distDir, '.whl');
  if (wheel === null) {
    process.stdout.write(`::error::no wheel produced under ${distDir}\n`);
    return 1;
  }

  const stageSuffix = computeStageSuffix(opts.stageTo, readPythonSource(pkgDir));
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
  const present = readZipEntry(readFileSync(wheel), (name) => {
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
