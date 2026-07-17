/**
 * Read the `Version:` field from a wheel's `*.dist-info/METADATA` (#450).
 *
 * The engine analogue of the bash
 * `unzip -p "$wheel" '*.dist-info/METADATA' | awk '/^Version:/ { print $2 }'`,
 * but via the pure-Node zip reader so it needs no `unzip`. Returns the
 * version string, or null when the wheel carries no METADATA or no
 * `Version:` line. `Metadata-Version:` is deliberately not matched — only a
 * line that begins exactly `Version:`, mirroring the bash `^Version:`.
 */

import { readFile } from 'node:fs/promises';

import { readZipEntry } from './read-zip-entry.js';

export async function readWheelVersion(wheelPath: string): Promise<string | null> {
  const meta = readZipEntry(await readFile(wheelPath), (name) => name.endsWith('.dist-info/METADATA'));
  if (meta === null) {
    return null;
  }
  for (const line of meta.toString('utf8').split(/\r?\n/)) {
    const m = /^Version:[ \t]*(\S+)/.exec(line);
    if (m) {
      return m[1]!;
    }
  }
  return null;
}
