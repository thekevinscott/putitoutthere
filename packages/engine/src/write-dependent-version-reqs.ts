/**
 * Move the in-repo version requirements that point at a crate whose version
 * just changed (#640). Releasing B past A's `path` + `version` requirement
 * fails cargo at exit 101 — "failed to select a version for the requirement
 * expcore = ^0.2 … location searched: …/packages/core" — and that local path is
 * why registry state cannot rescue it. Rewrites requirements, never a version.
 */

import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { candidateDirs } from './candidate-dirs.js';
import { findWorkspaceRoot } from './find-workspace-root.js';
import { readCargoManifest } from './read-cargo-manifest.js';
import { replaceDepVersionReq } from './replace-dep-version-req.js';
import { resolveDepDirs } from './resolve-dep-dirs.js';

/**
 * Rewrite every in-repo `version = "…"` requirement that points at the crate at
 * `crateDir` to `version`; returns the absolute paths modified. `siblingDirs`
 * are other declared packages' dirs, which may sit outside any shared workspace,
 * so they are scanned as well as its members. Only entries resolving to `crateDir` move.
 */
export async function writeDependentVersionReqs(
  crateDir: string,
  version: string,
  siblingDirs?: readonly string[],
): Promise<string[]> {
  // Canonicalize first: every candidate directory below arrives via
  // `resolve`, and the check that decides whether a dependency points at
  // this crate is string equality on those paths.
  const target = resolve(crateDir);

  const workspaceRoot = await findWorkspaceRoot(target);
  const workspaceParsed =
    workspaceRoot === null ? null : (await readCargoManifest(workspaceRoot))?.parsed;

  const written: string[] = [];
  // The released crate's own manifest is scanned like any other and simply
  // never matches: cargo has no way to express a dependency on yourself, so
  // no entry in it can resolve back to `target`.
  //
  // A member that inherits its requirement (`core.workspace = true`) is
  // likewise a no-op here rather than a special case — the entry carries no
  // `path` of its own, and `replaceDepVersionReq` only rewrites entries that
  // do. The requirement it inherits lives in the workspace root, which is a
  // candidate in its own right, so rewriting it there covers every member.
  for (const dir of await candidateDirs(workspaceRoot, workspaceParsed, siblingDirs)) {
    const manifest = await readCargoManifest(dir);
    if (manifest === null) {continue;}

    let updated = manifest.source;
    for (const dep of resolveDepDirs(manifest.parsed, dir, workspaceParsed, workspaceRoot)) {
      if (!dep.hasVersionReq || dep.dir !== target) {continue;}
      updated = replaceDepVersionReq(updated, dep.key, version);
    }
    if (updated !== manifest.source) {
      const cargoPath = join(dir, 'Cargo.toml');
      await writeFile(cargoPath, updated, 'utf8');
      written.push(cargoPath);
    }
  }
  return written;
}
