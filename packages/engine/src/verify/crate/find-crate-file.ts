/**
 * The path to a non-empty `<name>-<version>.crate` under `registryRoot`, or
 * null when none exists (or the only match is empty) (#449).
 *
 * The synchronous analogue of the bash
 * `find "$REG_ROOT" -name "${name}-${version}.crate" -type f -print -quit`
 * followed by the `[ -z … ] || [ ! -s … ]` non-empty guard. `cargo-http-
 * registry` stores `.crate` files nested under the root, so the search
 * recurses.
 */

import { statSync } from 'node:fs';
import { basename } from 'node:path';

import { listFilesRecursive } from '../../utils/list-files-recursive.js';

export function findCrateFile(
  registryRoot: string,
  name: string,
  version: string,
): string | null {
  const target = `${name}-${version}.crate`;
  for (const file of listFilesRecursive(registryRoot)) {
    if (basename(file) === target && statSync(file).size > 0) {
      return file;
    }
  }
  return null;
}
