/**
 * `putitoutthere advance-floating-major` — move the floating `v<major>` tag
 * to the newest release in its major line (#446, epic #442).
 *
 * Extraction of `release-npm.yml`'s inline "Move floating major tag" bash.
 * Scaffolded consumer workflows reference
 * `thekevinscott/putitoutthere@v<major>` (the community `actions/checkout@v4`
 * convention); the canonical per-release tag is
 * `putitoutthere-v<x.y.z>`, so this keeps a floating `v<major>` pointing at
 * the latest release in the major line. Idempotent: a re-run is a no-op
 * when the floating tag already matches the latest release.
 *
 * Reuses the release path's own resolvers rather than re-globbing/sorting
 * in parallel: `lastTag` finds the highest release tag for the (single)
 * package the config declares, `parseTagVersion` reads the version back
 * out, and the shared `forceMoveTag` performs the move — so the floating
 * tag can never track a release the publish path wouldn't recognize.
 */

import { join } from 'node:path';

import { loadConfig } from './config.js';
import { forceMoveTag } from './force-move-tag.js';
import { fetchTagsForce, lastTag, tagCommit, tagList } from './git.js';
import { parseTagVersion } from './tag-template.js';

export async function advanceFloatingMajor(opts: { cwd: string }): Promise<number> {
  const gitOpts = { cwd: opts.cwd };
  const config = loadConfig(join(opts.cwd, 'putitoutthere.toml'));
  const pkg = config.packages[0]!;

  // Refresh remote tags (force, so a tag moved on the remote since checkout
  // doesn't reject the fetch — #199) before re-deriving "latest release".
  await fetchTagsForce(gitOpts);

  const latest = await lastTag(pkg.name, pkg.tag_format, gitOpts);
  if (latest === null) {
    process.stdout.write('No putitoutthere-v* tags yet; nothing to track.\n');
    return 0;
  }

  // `lastTag` only returns a strict-semver tag, so parse + split can't miss.
  const version = parseTagVersion(pkg.tag_format, pkg.name, latest)!;
  const major = version.split('.')[0]!;
  const floating = `v${major}`;

  const target = await tagCommit(latest, gitOpts);
  const existing = await tagList(floating, gitOpts);
  const current = existing.length > 0 ? await tagCommit(floating, gitOpts) : null;
  if (current === target) {
    process.stdout.write(`Floating tag ${floating} already at ${latest}; no update.\n`);
    return 0;
  }

  process.stdout.write(
    `Moving floating tag ${floating} -> ${target} (latest release ${latest})\n`,
  );
  await forceMoveTag(floating, target, gitOpts);
  return 0;
}
