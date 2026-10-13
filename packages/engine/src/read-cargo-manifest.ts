import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

/** A manifest that exists and parses. Missing or malformed reads as null. */
export interface CargoManifest {
  source: string;
  parsed: unknown;
}

/**
 * Read and parse `<dir>/Cargo.toml`. Null when absent or unparseable — a
 * directory need not be a crate at all, and an odd-but-writable manifest
 * should not abort a release. ENOENT is caught rather than pre-checked to
 * avoid the TOCTOU shape CodeQL flags; any other read failure surfaces.
 */
export async function readCargoManifest(dir: string): Promise<CargoManifest | null> {
  let source: string;
  try {
    source = await readFile(join(dir, 'Cargo.toml'), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {return null;}
    throw err;
  }
  try {
    return { source, parsed: parseToml(source) };
  } catch {
    return null;
  }
}
