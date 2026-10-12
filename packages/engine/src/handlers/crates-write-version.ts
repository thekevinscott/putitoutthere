import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Ctx } from '../types.js';
import { toError } from '../to-error.js';
import { writeDependentVersionReqs } from '../write-dependent-version-reqs.js';
import { writeResolvedCargoVersion } from '../write-resolved-cargo-version.js';

export async function cratesWriteVersion(
  pkg: { path: string },
  version: string,
  ctx: Ctx,
): Promise<string[]> {
  const cargoPath = join(pkg.path, 'Cargo.toml');
  let original: string;
  try {
    original = await readFile(cargoPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Cargo.toml not found at ${cargoPath}`, { cause: err });
    }
    throw toError(err);
  }
  // #639: route through the shared resolver rather than the literal-only
  // rewriter. A crate that inherits its version (`version.workspace = true`)
  // has no `[package].version` to rewrite, and the literal path used to walk
  // past the table and corrupt a dependency's requirement instead. The
  // resolver detects inheritance and rewrites `[workspace.package].version`
  // at the workspace root — the same routing `write-version.ts` and
  // `write-crate-version.ts` have used since #428.
  //
  // Returns the manifests this write MANAGES, which is what the pre-publish
  // dirty-tree guard needs: for an inheriting crate that is a file outside
  // the package directory, and the guard would otherwise refuse on it.
  let written: string[];
  try {
    written = [...(await writeResolvedCargoVersion(pkg.path, original, version))];
  } catch (err) {
    throw toError(err);
  }
  // #640: bumping this crate moves it out of range of every in-repo
  // requirement that pointed at the old version, and cargo then refuses to
  // resolve the workspace at all — a hard failure before anything compiles,
  // hit by the next crates.io package in the cascade rather than by this
  // one. The build-time writers learned this in #621; the publish path is
  // the other half.
  written.push(
    ...(await writeDependentVersionReqs(pkg.path, version, ctx.siblingPackagePaths)),
  );
  return written;
}
