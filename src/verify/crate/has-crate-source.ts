/**
 * Whether the extracted crate tree surfaces `src/lib.rs` or `src/main.rs`
 * (#449). cargo packs into `<name>-<version>/{Cargo.toml,src/…}`, so any
 * file path ending in `/src/lib.rs` or `/src/main.rs` counts — the
 * analogue of the bash `find … -path` check on those two source entries.
 * This is the crates-side of the npm verify's "files[] dir is populated"
 * check: proof the publish shipped the source tree, not an empty tarball.
 */

import { basename, dirname } from 'node:path';

import { listFilesRecursive } from '../../utils/list-files-recursive.js';

export function hasCrateSource(dir: string): boolean {
  // Match a `lib.rs` / `main.rs` whose parent dir is `src`, via
  // basename/dirname rather than a `/src/…` string suffix — the extracted
  // paths use the platform separator, so a literal `/` check silently
  // misses on Windows (`…\src\lib.rs`) and the unit matrix goes red.
  return listFilesRecursive(dir).some((f) => {
    const name = basename(f);
    return (name === 'lib.rs' || name === 'main.rs') && basename(dirname(f)) === 'src';
  });
}
