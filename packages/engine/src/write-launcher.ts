/**
 * Author the npm bundled-cli launcher (`bin/<bin>.js`) at build time (#299), on
 * the main row of every `kind = "npm" && build = "bundled-cli"` package. An
 * existing `bin/<bin>.js` is never overwritten and `package.json#bin` is left
 * as-is, so a consumer's committed custom launcher stands.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { generateLauncherSource } from './generate-launcher-source.js';
import { detectIndent } from './handlers/detect-indent.js';

export interface WriteLauncherOptions {
  /** Absolute path to the main package directory. */
  pkgDir: string;
  /** The main package's npm name (`pkg.npm ?? pkg.name`). Inlined into the
   *  `{name}` slot of `platformNameTemplate`; also keys `package.json#bin`. */
  npmName: string;
  /** CLI binary name (`pkg.bundle_cli.bin`). Names the launcher file and
   *  the published `bin` entry. */
  bin: string;
  /** Platform-package name template, e.g. `{name}-{triple}` or
   *  `@my-cli/cli-{triple}`. `{triple}` is preserved as a JS template
   *  substitution at install time; all other placeholders resolve here. */
  platformNameTemplate: string;
  /** Supported target triples. Becomes the `triples` table in the
   *  generated launcher's Node `${platform}-${arch}` lookup. */
  triples: readonly string[];
}

/**
 * Author the launcher + `package.json#bin` entry for a bundled-cli npm
 * package. Idempotent: existing files / fields are left as-is so
 * consumers can override either piece independently.
 *
 * Returns the list of paths that were actually written.
 */
export async function writeLauncher(opts: WriteLauncherOptions): Promise<string[]> {
  const written: string[] = [];
  const launcherPath = join(opts.pkgDir, 'bin', `${opts.bin}.js`);
  // CodeQL TOCTOU: use `wx` (write-exclusive) rather than `existsSync`
  // precheck so the "absent only" guarantee is atomic. EEXIST means a
  // consumer-authored launcher (or a concurrent write) won this race —
  // exactly the override path we want to respect.
  await mkdir(dirname(launcherPath), { recursive: true });
  try {
    await writeFile(launcherPath, generateLauncherSource(opts), { encoding: 'utf8', flag: 'wx' });
    written.push(launcherPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {throw err;}
  }

  const pkgJsonPath = join(opts.pkgDir, 'package.json');
  const raw = await readFile(pkgJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed['bin'] === undefined) {
    parsed['bin'] = { [opts.bin]: `bin/${opts.bin}.js` };
    const indent = detectIndent(raw);
    const trailing = raw.endsWith('\n') ? '\n' : '';
    await writeFile(pkgJsonPath, JSON.stringify(parsed, null, indent) + trailing, 'utf8');
    written.push(pkgJsonPath);
  }
  return written;
}
