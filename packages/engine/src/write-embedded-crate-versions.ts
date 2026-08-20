/**
 * Bump every in-repo crate an artifact compiles, plus the version
 * requirements that point at them. #621.
 *
 * The three pre-build writers each bump the crate the build tool reads as
 * its version source — maturin's `matrix.path`, `bundle_cli.crate_path`,
 * the napi crate. That answers "what version is this artifact?" but not
 * "whose `CARGO_PKG_VERSION` is observable *from* this artifact?" Those
 * sets coincide only when the artifact is one crate deep. Embed a sibling
 * by path, let the sibling own the version-bearing symbol (clap's
 * `#[command(version)]` expands `env!("CARGO_PKG_VERSION")` inside the
 * crate where the attribute is written), and nothing bumps the sibling.
 *
 * `CARGO_PKG_VERSION` is a compile-time constant scoped per crate and has
 * no env override — not `CARGO_PKG_VERSION=… cargo build`, not
 * `.cargo/config.toml [env]` with `force = true`. Rewriting the manifest
 * before the build is the only lever there is.
 *
 * **Semantics: the artifact's version wins.** Every in-repo crate the
 * artifact compiles is stamped with the artifact's release version, so a
 * user who installs `dirsql 0.4.2` sees `0.4.2` from every surface the
 * artifact exposes. The alternative — giving each declared `[[package]]`
 * its own planned version — is indistinguishable for a repo whose crates
 * cascade together at one version, and differs only where a repo keeps
 * crates on deliberately separate version lines. It can be layered on
 * later using this same requirement-rewrite machinery.
 *
 * The rewrites are ephemeral: the build job's checkout is thrown away and
 * `publish` runs in a separate job off a fresh checkout, so nothing here
 * reaches the crates handler's dirty-tree check or a published manifest.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { findWorkspaceRoot } from './find-workspace-root.js';
import { replaceDepVersionReq } from './replace-dep-version-req.js';
import { resolveDepDirs } from './resolve-dep-dirs.js';
import { writeResolvedCargoVersion } from './write-resolved-cargo-version.js';

/**
 * Walk the path-dependency graph out of `startDir`, bump every crate
 * reached to `version`, and rewrite every in-repo version requirement
 * that points at one of them. Returns the absolute paths modified.
 *
 * `startDir` itself is assumed already bumped by the caller (that is the
 * pre-existing writer's job); it is still included when rewriting
 * requirements, since a sibling may depend on it.
 *
 * Reachability from the built crate is the criterion, not workspace
 * membership: a sibling member nobody depends on is not in the artifact
 * and is left alone.
 */
export async function writeEmbeddedCrateVersions(
  startDir: string,
  version: string,
): Promise<string[]> {
  // Any non-string stands for "no workspace above this crate" — the walk
  // legitimately returns null at the filesystem root.
  const found = await findWorkspaceRoot(startDir);
  const workspaceRoot = typeof found === 'string' ? found : null;
  const workspaceParsed =
    workspaceRoot === null ? null : await readManifest(join(workspaceRoot, 'Cargo.toml'));

  const embedded = await collectEmbedded(startDir, workspaceParsed, workspaceRoot);
  const written = new Set<string>();

  // 1. Bump each embedded crate. `writeResolvedCargoVersion` follows
  //    `version.workspace = true` up to the workspace root (#428).
  for (const dir of embedded) {
    const cargoPath = join(dir, 'Cargo.toml');
    const source = await readFileOrNull(cargoPath);
    if (source === null || !hasPackageTable(source)) {continue;}
    for (const p of await writeResolvedCargoVersion(dir, source, version)) {written.add(p);}
  }

  // 2. Rewrite requirements pointing at anything bumped. The workspace
  //    root is included because an inheriting member's requirement lives
  //    there, in a file no member's own rewrite would touch.
  const bumped = new Set<string>([...embedded, startDir]);
  const manifestDirs = new Set<string>([...embedded, startDir]);
  if (workspaceRoot !== null) {manifestDirs.add(workspaceRoot);}

  for (const dir of manifestDirs) {
    const cargoPath = join(dir, 'Cargo.toml');
    const source = await readFileOrNull(cargoPath);
    if (source === null) {continue;}
    const parsed = safeParse(source);
    if (parsed === null) {continue;}

    let updated = source;
    for (const dep of resolveDepDirs(parsed, dir, workspaceParsed, workspaceRoot)) {
      // An inherited entry's requirement lives in the root, and the root
      // is visited in its own right — rewriting it from the member would
      // target a `version` key the member does not have.
      if (dep.inheritsFromWorkspace) {continue;}
      if (!dep.hasVersionReq || !bumped.has(dep.dir)) {continue;}
      updated = replaceDepVersionReq(updated, dep.key, version);
    }
    if (updated !== source) {
      await writeFile(cargoPath, updated, 'utf8');
      written.add(cargoPath);
    }
  }

  return [...written];
}

/**
 * Breadth-first walk of path dependencies out of `startDir`. Returns the
 * crates reached, excluding `startDir`.
 */
async function collectEmbedded(
  startDir: string,
  workspaceParsed: unknown,
  workspaceRoot: string | null,
): Promise<Set<string>> {
  const seen = new Set<string>([startDir]);
  const found = new Set<string>();
  const queue: string[] = [startDir];

  while (queue.length > 0) {
    const dir = queue.shift() as string;
    const source = await readFileOrNull(join(dir, 'Cargo.toml'));
    if (source === null) {continue;}
    const parsed = safeParse(source);
    if (parsed === null) {continue;}

    for (const dep of resolveDepDirs(parsed, dir, workspaceParsed, workspaceRoot)) {
      if (seen.has(dep.dir)) {continue;}
      seen.add(dep.dir);
      found.add(dep.dir);
      queue.push(dep.dir);
    }
  }
  return found;
}

async function readManifest(path: string): Promise<unknown> {
  const source = await readFileOrNull(path);
  return source === null ? null : safeParse(source);
}

/** Read a file, or `null` when it does not exist. */
async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {return null;}
    throw err;
  }
}

/** A virtual manifest declares `[workspace]` but no crate to version. */
function hasPackageTable(source: string): boolean {
  const parsed = safeParse(source);
  return parsed !== null && typeof (parsed as { package?: unknown }).package === 'object';
}

function safeParse(source: string): unknown {
  try {
    return parseToml(source);
  } catch {
    return null;
  }
}
