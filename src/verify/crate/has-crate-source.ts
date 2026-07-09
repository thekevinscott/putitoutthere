/**
 * Whether the extracted crate tree surfaces `src/lib.rs` or `src/main.rs`
 * (#449). cargo packs into `<name>-<version>/{Cargo.toml,src/…}`, so any
 * file path ending in `/src/lib.rs` or `/src/main.rs` counts — the
 * analogue of the bash `find … -path` check on those two source entries.
 * This is the crates-side of the npm verify's "files[] dir is populated"
 * check: proof the publish shipped the source tree, not an empty tarball.
 */

import { listFilesRecursive } from '../../utils/list-files-recursive.js';

export function hasCrateSource(dir: string): boolean {
  return listFilesRecursive(dir).some(
    (f) => f.endsWith('/src/lib.rs') || f.endsWith('/src/main.rs'),
  );
}
