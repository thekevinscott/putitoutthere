/**
 * Move the in-repo version requirements that point at a crate whose version
 * just changed. #640.
 *
 * #621 taught the *build*-time writers this, for the crates an artifact
 * embeds. The *publish* path never learned it: the crates handler bumps
 * exactly one manifest, the crate's own. For two crates.io packages in one
 * repo where A path-deps B, releasing B moves it past A's requirement and
 * nothing updates A:
 *
 *     error: failed to select a version for the requirement `expcore = "^0.2"`
 *     candidate versions found which didn't match: 0.4.2
 *     location searched: …/packages/core
 *
 * A hard failure (exit 101) before anything compiles or packages, and an
 * intermittent one — a repo on a patch cadence stays green until the first
 * bump that leaves the declared range. `location searched` naming the local
 * path is also why registry state cannot rescue it: for a `path` + `version`
 * dependency cargo checks the requirement against the path crate's on-disk
 * manifest.
 *
 * A `version` key alongside `path` is *mandatory* for any crate that also
 * publishes to crates.io, so the shape that breaks is the shape such a repo
 * is required to have.
 *
 * This is the inverse walk of `write-embedded-crate-versions.ts`: that one
 * walks *out* from a crate to what it embeds, this one looks *in* at what
 * points back. It rewrites requirements only; no crate's version is bumped
 * here, because at publish time each package owns its own planned version
 * and stamping a neighbour's would publish a version nobody planned.
 *
 * Like #621's rewrites these are ephemeral — the publish job runs off a
 * fresh checkout and nothing is committed — but unlike #621's they happen in
 * the same job as `cargo publish`, so the pre-publish dirty-tree check has
 * to be told which manifests they touched.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { expandDirGlob } from './glob.js';
import { findWorkspaceRoot } from './find-workspace-root.js';
import { replaceDepVersionReq } from './replace-dep-version-req.js';
import { resolveDepDirs } from './resolve-dep-dirs.js';

/**
 * Rewrite every in-repo `version = "…"` requirement that points at the crate
 * at `crateDir` to `version`. Returns the absolute paths modified.
 *
 * `siblingDirs` are the other declared packages' directories — they may sit
 * outside any shared cargo workspace, so they are scanned in addition to the
 * workspace's own members rather than instead of them.
 *
 * Only entries that resolve to `crateDir` move. A registry dependency, or a
 * path dependency pointing anywhere else, keeps its requirement: pinning
 * pyo3 to this release's version would name a pyo3 that does not exist.
 */
export async function writeDependentVersionReqs(
  crateDir: string,
  version: string,
  siblingDirs: readonly string[] = [],
): Promise<string[]> {
  // Canonicalize first: every candidate directory below arrives via
  // `resolve`, and the check that decides whether a dependency points at
  // this crate is string equality on those paths.
  const target = resolve(crateDir);

  const found = await findWorkspaceRoot(target);
  const workspaceRoot = typeof found === 'string' ? found : null;
  const workspaceParsed =
    workspaceRoot === null ? null : (await readManifest(workspaceRoot))?.parsed ?? null;

  const written: string[] = [];
  for (const dir of await candidateDirs(workspaceRoot, workspaceParsed, siblingDirs)) {
    // The crate's own manifest cannot declare a requirement on itself.
    if (dir === target) {continue;}
    const manifest = await readManifest(dir);
    if (manifest === null) {continue;}

    let updated = manifest.source;
    for (const dep of resolveDepDirs(manifest.parsed, dir, workspaceParsed, workspaceRoot)) {
      // `inheritsFromWorkspace` entries carry no `path` of their own — the
      // requirement lives in the workspace root, which is itself a candidate
      // here, so rewriting it there covers every member that inherits it.
      if (dep.inheritsFromWorkspace || !dep.hasVersionReq || dep.dir !== target) {continue;}
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
  siblingDirs: readonly string[],
): Promise<Set<string>> {
  const dirs = new Set<string>();
  for (const d of siblingDirs) {dirs.add(resolve(d));}
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
