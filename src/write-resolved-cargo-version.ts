import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { findWorkspaceRoot } from './find-workspace-root.js';
import { replaceCargoVersion } from './handlers/crates.js';
import { replaceWorkspacePackageVersion } from './replace-workspace-package-version.js';

/**
 * Rewrite a crate's version to `version`, following Cargo workspace
 * inheritance (#428):
 *
 *  - a literal `[package].version = "x.y.z"` is rewritten in place;
 *  - a member that inherits via `version.workspace = true` has the
 *    workspace root's `[workspace.package].version` rewritten instead.
 *
 * `crateDir` is the crate's directory and `cargoSource` its already-read
 * `Cargo.toml` (callers own the file-missing error message and hand the
 * bytes here). Returns the absolute path(s) actually modified. Throws when
 * the crate declares no resolvable version source (via `replaceCargoVersion`),
 * or when it inherits but no ancestor `[workspace]` exists.
 */
export function writeResolvedCargoVersion(
  crateDir: string,
  cargoSource: string,
  version: string,
): string[] {
  // Detect inheritance from the parsed manifest. An unparseable manifest
  // falls through to the literal path, preserving the pre-#428 regex
  // behavior for odd-but-writable manifests.
  let pkgVersion: unknown;
  try {
    pkgVersion = (parseToml(cargoSource) as { package?: { version?: unknown } }).package?.version;
  } catch {
    pkgVersion = undefined;
  }
  const inherits =
    !!pkgVersion &&
    typeof pkgVersion === 'object' &&
    (pkgVersion as { workspace?: unknown }).workspace === true;

  if (!inherits) {
    // Literal `[package].version` (or genuinely absent — replaceCargoVersion
    // throws the same "no [package].version" error the callers relied on).
    const cargoPath = join(crateDir, 'Cargo.toml');
    const updated = replaceCargoVersion(cargoSource, version);
    if (updated !== cargoSource) {writeFileSync(cargoPath, updated, 'utf8');}
    return [cargoPath];
  }

  const root = findWorkspaceRoot(crateDir);
  if (root === null) {
    throw new Error(
      `Cargo.toml: ${join(crateDir, 'Cargo.toml')} sets \`version.workspace = true\` but no ancestor [workspace] Cargo.toml was found. Declare [workspace.package].version at the workspace root.`,
    );
  }
  const rootPath = join(root, 'Cargo.toml');
  const rootSource = readFileSync(rootPath, 'utf8');
  const updated = replaceWorkspacePackageVersion(rootSource, version);
  if (updated !== rootSource) {writeFileSync(rootPath, updated, 'utf8');}
  return [rootPath];
}
