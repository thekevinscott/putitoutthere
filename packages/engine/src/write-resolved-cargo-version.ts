import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { findWorkspaceRoot } from './find-workspace-root.js';
import { replaceCargoVersion } from './replace-cargo-version.js';
import { replaceWorkspacePackageVersion } from './replace-workspace-package-version.js';

/**
 * Rewrite a crate's version to `version`, following Cargo workspace inheritance
 * (#428): a literal `[package].version` in place, or — for a member with
 * `version.workspace = true` — the root's `[workspace.package].version`. Throws
 * with no resolvable version source, or on inheritance with no `[workspace]`.
 */
export async function writeResolvedCargoVersion(
  crateDir: string,
  cargoSource: string,
  version: string,
): Promise<string[]> {
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
    if (updated !== cargoSource) {await writeFile(cargoPath, updated, 'utf8');}
    return [cargoPath];
  }

  const root = await findWorkspaceRoot(crateDir);
  if (root === null) {
    throw new Error(
      `Cargo.toml: ${join(crateDir, 'Cargo.toml')} sets \`version.workspace = true\` but no ancestor [workspace] Cargo.toml was found. Declare [workspace.package].version at the workspace root.`,
    );
  }
  const rootPath = join(root, 'Cargo.toml');
  const rootSource = await readFile(rootPath, 'utf8');
  const updated = replaceWorkspacePackageVersion(rootSource, version);
  if (updated !== rootSource) {await writeFile(rootPath, updated, 'utf8');}
  return [rootPath];
}
