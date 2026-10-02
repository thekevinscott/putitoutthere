/**
 * Bump every in-repo crate an artifact compiles, plus the requirements pointing
 * at them (#621). `CARGO_PKG_VERSION` is a compile-time constant scoped per
 * crate with no env override (not `CARGO_PKG_VERSION=… cargo build`, not
 * `.cargo/config.toml [env] force = true`), so an embedded sibling owning the
 * version symbol (clap's `#[command(version)]`) stays stale. Artifact's version wins.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { findWorkspaceRoot } from './find-workspace-root.js';
import { replaceDepVersionReq } from './replace-dep-version-req.js';
import { resolveDepDirs } from './resolve-dep-dirs.js';
import { writeResolvedCargoVersion } from './write-resolved-cargo-version.js';

/** A manifest that exists and parses. Missing or malformed reads as null. */
interface Manifest {
  source: string;
  parsed: unknown;
}

/**
 * Walk the path-dependency graph out of `startDir`, bump every crate reached to
 * `version`, and rewrite every in-repo requirement pointing at one; returns the
 * absolute paths modified. `startDir` is assumed already bumped by the caller.
 * Reachability, not workspace membership: a member nobody depends on is skipped.
 */
export async function writeEmbeddedCrateVersions(
  startDir: string,
  version: string,
): Promise<string[]> {
  // Canonicalize before anything is compared. Every directory discovered
  // below arrives via `resolve`, so a caller-supplied `startDir` that is
  // relative, trailing-separated, or (on Windows) drive-letter-less would
  // never equal its own resolved form — and the identity checks that keep
  // the walk finite and stop the starting crate being re-bumped are all
  // string equality on these paths.
  const start = resolve(startDir);

  // Any non-string stands for "no workspace above this crate" — the walk
  // legitimately returns null at the filesystem root.
  const found = await findWorkspaceRoot(start);
  const workspaceRoot = typeof found === 'string' ? found : null;
  const workspaceParsed =
    workspaceRoot === null ? null : (await readManifest(workspaceRoot))?.parsed;

  const embedded = await collectEmbedded(start, workspaceParsed, workspaceRoot);
  const written = new Set<string>();

  // 1. Bump each embedded crate. `writeResolvedCargoVersion` follows
  //    `version.workspace = true` up to the workspace root (#428).
  for (const dir of embedded) {
    const manifest = await readManifest(dir);
    // A virtual manifest declares `[workspace]` but no crate to version.
    if (manifest === null || !hasPackageTable(manifest.parsed)) {continue;}
    for (const p of await writeResolvedCargoVersion(dir, manifest.source, version)) {
      written.add(p);
    }
  }

  // 2. Rewrite requirements pointing at anything bumped. The workspace
  //    root is included because an inheriting member's requirement lives
  //    there, in a file no member's own rewrite would touch.
  const bumped = new Set<string>([...embedded, start]);
  const manifestDirs = new Set<string>([...embedded, start]);
  if (workspaceRoot !== null) {manifestDirs.add(workspaceRoot);}

  for (const dir of manifestDirs) {
    const manifest = await readManifest(dir);
    if (manifest === null) {continue;}

    let updated = manifest.source;
    for (const dep of resolveDepDirs(manifest.parsed, dir, workspaceParsed, workspaceRoot)) {
      // A requirement is rewritten only when it points at a crate this run
      // actually bumped. The workspace root routinely declares members the
      // artifact never compiles; pinning those to the release version would
      // name a version nothing produced.
      if (!dep.hasVersionReq || !bumped.has(dep.dir)) {continue;}
      updated = replaceDepVersionReq(updated, dep.key, version);
    }
    if (updated !== manifest.source) {
      const cargoPath = join(dir, 'Cargo.toml');
      await writeFile(cargoPath, updated, 'utf8');
      written.add(cargoPath);
    }
  }

  return [...written];
}

/**
 * Breadth-first walk of path dependencies out of `startDir`. Returns the
 * crates reached, excluding `startDir` — seeding `seen` with it also keeps
 * a dependency cycle back to the start from re-queueing forever.
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
    const manifest = await readManifest(dir);
    if (manifest === null) {continue;}

    for (const dep of resolveDepDirs(manifest.parsed, dir, workspaceParsed, workspaceRoot)) {
      if (seen.has(dep.dir)) {continue;}
      seen.add(dep.dir);
      found.add(dep.dir);
      queue.push(dep.dir);
    }
  }
  return found;
}

/**
 * Read and parse `<dir>/Cargo.toml`. Returns null when the file is absent
 * or unparseable — a path dependency can point at a directory that is not
 * a crate, and an odd-but-writable manifest should not abort the release.
 *
 * ENOENT is caught rather than pre-checked with `existsSync` to avoid the
 * TOCTOU shape CodeQL flags, matching the rest of the version-write path.
 * Any other read failure surfaces unmodified.
 */
async function readManifest(dir: string): Promise<Manifest | null> {
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

/**
 * A virtual manifest declares `[workspace]` but no crate to version.
 * `parsed` always comes from `readManifest`, which yields a parsed TOML
 * document or null, so the null case never reaches here.
 */
function hasPackageTable(parsed: unknown): boolean {
  return typeof (parsed as { package?: unknown }).package === 'object';
}
