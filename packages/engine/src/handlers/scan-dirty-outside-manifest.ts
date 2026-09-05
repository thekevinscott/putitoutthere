/**
 * The narrowed dirty-tree check the crates handler runs before cargo (#135).
 *
 * `--allow-dirty` is required for our writeVersion-then-publish model, but
 * cargo's default dirty-check is exactly the safety net that catches shipping
 * uncommitted stray edits. This restores a narrower version of it: scan the
 * working tree via `git status --porcelain` and refuse to publish if anything
 * is dirty outside the manifests writeVersion just wrote. "Manifests", plural,
 * for two reasons: an inheriting crate's version lives at the workspace root
 * (#639), and bumping a crate also moves the in-repo requirements that point at
 * it (#640), which live in other crates' files. Either way the write can land
 * outside the package directory entirely.
 */

import { relative } from 'node:path';

import { execCapture } from '../utils/exec-capture.js';
import { repoRelativePaths } from '../repo-relative-paths.js';

/**
 * Return paths of dirty working-tree files that are NOT the package's
 * managed Cargo.toml. Returns null if we can't determine (not inside
 * a git work tree, git command missing, etc) — callers treat null as
 * "can't verify, fall through to cargo's own --allow-dirty behavior."
 */
export async function scanDirtyOutsideManifest(
  cwd: string,
  pkgPath: string,
  artifactsRoot?: string,
  siblingPackagePaths?: readonly string[],
  managedManifestPaths?: readonly string[],
): Promise<string[] | null> {
  // Confirm we're inside a git work tree. If not, bail and let cargo's
  // own --allow-dirty handling take over.
  try {
    const topOut = (await execCapture('git', ['rev-parse', '--show-toplevel'], {
      cwd,
    })).stdout;
    if (!topOut.trim()) {return null;}
  } catch {
    return null;
  }
  // Ask git for the managed file's path relative to the repo root, so
  // we can string-compare against porcelain output directly without
  // fighting platform path conventions (macOS /private/ symlinks,
  // Windows 8.3 short names + case-insensitive FS).
  const managedRels = new Set<string>();
  try {
    const rel = (await execCapture('git', ['ls-files', '--full-name', '--', 'Cargo.toml'], {
      cwd: pkgPath,
    })).stdout.trim();
    managedRels.add(rel);
  } catch {
    // Cargo.toml not tracked (e.g. first release on a fresh tree).
    // Fall through; an empty set means nothing is allowed dirty. (An
    // untracked manifest yields an empty `rel`, which porcelain can never
    // name either, so it is harmless in the set.)
  }
  // #639: whatever writeVersion actually wrote. For a crate that inherits
  // its version the bump lands in the workspace root's Cargo.toml, which is
  // outside the package directory and would otherwise read as a stray edit
  // and refuse the publish.
  for (const rel of repoRelativePaths(cwd, managedManifestPaths)) {managedRels.add(rel);}
  let porcelain: string;
  try {
    porcelain = (await execCapture('git', ['status', '--porcelain'], {
      cwd,
    })).stdout;
  } catch {
    return null;
  }
  // Reusable workflow's `actions/download-artifact@v4` step creates
  // `artifacts/` under cwd unconditionally — even for fixtures whose
  // packages don't upload anything (crates-only). That entry is engine-
  // managed scratch space, not a stray edit; skip it.
  let artifactsRel = '';
  if (artifactsRoot !== undefined && artifactsRoot !== '') {
    const r = relative(cwd, artifactsRoot);
    artifactsRel = r === '' ? '' : r.replace(/\\/g, '/');
  }
  // Sibling package directories — anything inside them is workflow
  // state from another handler (e.g. node_modules/ + package-lock.json
  // + dist/ from the npm `Build npm packages` step). cargo only packs
  // files inside its own package dir, so these can't end up in the
  // crate tarball regardless of whether they're "dirty" by git's view.
  const siblingRels = repoRelativePaths(cwd, siblingPackagePaths);
  const unexpected: string[] = [];
  for (const raw of porcelain.split('\n')) {
    if (raw.length < 4) {continue;}
    // Porcelain v1: "XY path" or "XY old -> new" for renames. Index 3+
    // is the path; strip quoting if git applied any.
    const rest = raw.slice(3);
    const path = rest.includes(' -> ') ? rest.split(' -> ').pop()! : rest;
    const normalized = path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
    if (managedRels.has(normalized)) {continue;}
    if (
      artifactsRel !== '' &&
      (normalized === artifactsRel ||
        normalized === `${artifactsRel}/` ||
        normalized.startsWith(`${artifactsRel}/`))
    ) {
      continue;
    }
    if (
      siblingRels.some(
        (s) =>
          normalized === s ||
          normalized === `${s}/` ||
          normalized.startsWith(`${s}/`),
      )
    ) {
      continue;
    }
    unexpected.push(normalized);
  }
  return unexpected;
}
