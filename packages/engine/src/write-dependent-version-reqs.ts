/**
 * Move the in-repo version requirements that point at a crate whose version
 * just changed (#640). Releasing B past A's `path` + `version` requirement
 * fails cargo at exit 101 — "failed to select a version for the requirement
 * expcore = ^0.2 … location searched: …/packages/core" — and that local path is
 * why registry state cannot rescue it. Rewrites requirements, never a version.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { expandDirGlob } from './glob.js';
import { findWorkspaceRoot } from './find-workspace-root.js';
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
    workspaceRoot === null ? null : (await readManifest(workspaceRoot))?.parsed;

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
    const manifest = await readManifest(dir);
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

/**
 * Every manifest that could declare a requirement on the released crate: the
 * workspace root (where an inheriting member's requirement actually lives),
 * each of its members, and the other declared packages.
 *
 * Members are expanded with `expandDirGlob`, which mirrors how cargo resolves
 * `[workspace].members` — a literal entry resolves as written, a glob entry
 * matches against the real tree. Scanning members rather than only the
 * declared packages matters because a crate the repo does not publish can
 * still sit between two that it does, and cargo resolves the whole graph.
 */
async function candidateDirs(
  workspaceRoot: string | null,
  workspaceParsed: unknown,
  siblingDirs: readonly string[] | undefined,
): Promise<Set<string>> {
  const dirs = new Set<string>();
  // An explicit guard rather than a `?? []` default: the caller holds an
  // optional field, and "no sibling packages" and "an empty list of them"
  // are the same thing to this walk.
  if (siblingDirs !== undefined) {
    for (const d of siblingDirs) {dirs.add(resolve(d));}
  }
  if (workspaceRoot === null) {return dirs;}

  dirs.add(resolve(workspaceRoot));
  const members = (workspaceParsed as { workspace?: { members?: unknown } } | null)?.workspace
    ?.members;
  if (!Array.isArray(members)) {return dirs;}
  for (const member of members) {
    if (typeof member !== 'string') {continue;}
    for (const d of await expandDirGlob(workspaceRoot, member)) {dirs.add(resolve(d));}
  }
  return dirs;
}

/**
 * Read and parse `<dir>/Cargo.toml`. Null when absent or unparseable — a
 * declared package directory need not be a crate at all, and an
 * odd-but-writable manifest should not abort a release. ENOENT is caught
 * rather than pre-checked to avoid the TOCTOU shape CodeQL flags, matching
 * the rest of the version-write path.
 */
async function readManifest(dir: string): Promise<{ source: string; parsed: unknown } | null> {
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
