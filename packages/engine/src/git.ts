/**
 * Thin wrapper around the `git` CLI for the ops putitoutthere needs. Stderr is
 * captured and surfaced in thrown errors so failures are diagnosable without a
 * --verbose re-run. Issue #9. Plan: §13.6 (no-push tag model), §14.2.
 */

import type { GitOptions } from './git-types.js';
import { runGit } from './run-git.js';

export type { GitOptions } from './git-types.js';
export { createTag } from './create-tag.js';
export { diffNames } from './diff-names.js';
export { hasStagedChanges } from './has-staged-changes.js';
export { lastTag } from './last-tag.js';
export { remoteTagExists } from './remote-tag-exists.js';
export { tagList } from './tag-list.js';
export { tagsPointingAtHead } from './tags-pointing-at-head.js';

/* ---------------------------- observers ---------------------------- */

export async function headCommit(opts: GitOptions = {}): Promise<string> {
  return runGit(['rev-parse', 'HEAD'], opts);
}

export async function commitBody(sha: string, opts: GitOptions = {}): Promise<string> {
  // %B = raw body (subject + body, no trailer folding).
  return runGit(['log', '-1', '--format=%B', sha], opts);
}

export async function commitParents(sha: string, opts: GitOptions = {}): Promise<string[]> {
  // %P = parent SHAs, space-separated. Merge commits have ≥2;
  // plain commits have 1; root commits have 0.
  const out = await runGit(['log', '-1', '--format=%P', sha], opts);
  if (out === '') {return [];}
  return out.split(' ').filter((s) => s.length > 0);
}

/* ------------------------------ tags ------------------------------ */

export async function pushTag(name: string, opts: GitOptions = {}): Promise<void> {
  await runGit(['push', 'origin', name], opts);
}

/**
 * `git fetch --tags --force origin` — refresh every remote tag, forcing
 * updates for tags that moved on the remote. The `--force` is load-bearing
 * (#199): without it a tag the remote force-moved since checkout is
 * rejected as a non-fast-forward, failing the fetch. Used before the
 * floating-major-tag move re-derives "latest release" from local tags.
 */
export async function fetchTagsForce(opts: GitOptions = {}): Promise<void> {
  await runGit(['fetch', '--tags', '--force', 'origin'], opts);
}

/**
 * `git tag -f <name> <target>` — create or move a lightweight tag to
 * `target`, overwriting an existing tag of the same name. The local half of
 * a floating-tag move; pair with `pushTagRefForce` to publish it.
 */
export async function forceTag(name: string, target: string, opts: GitOptions = {}): Promise<void> {
  await runGit(['tag', '-f', name, target], opts);
}

/**
 * `git push --force origin refs/tags/<name>` — force-publish a single moved
 * tag, ref-scoped so it is invisible to every other tag. The remote half of
 * a floating-tag move: unlike `pushTagRef` (which fails on a non-fast-
 * forward), this overwrites the remote tag, which floating tags require.
 */
export async function pushTagRefForce(name: string, opts: GitOptions = {}): Promise<void> {
  await runGit(['push', '--force', 'origin', `refs/tags/${name}`], opts);
}

/**
 * Push a single tag ref-scoped: `git push origin refs/tags/<name>`. Scoped
 * to the one ref so it is invisible to every other tag — a consumer's
 * floating major tag moving mid-run can't make it fail (#436) — and
 * idempotent (a no-op when the engine's warn-only push, #407, already
 * landed it). A genuine conflict (the same tag at a different commit on the
 * remote) still fails loudly, which the release concurrency group exists to
 * prevent. Distinct from `pushTag`, which pushes by bare name (#444).
 */
export async function pushTagRef(name: string, opts: GitOptions = {}): Promise<void> {
  await runGit(['push', 'origin', `refs/tags/${name}`], opts);
}

/* ---------------------------- staging ---------------------------- */

/**
 * `git add -f <pathspec>` — stage `pathspec`, overriding `.gitignore`. The
 * action bundle (`dist-action/`) is gitignored on main and exists only on
 * tag commits, so folding it in requires the force flag.
 */
export async function addForce(pathspec: string, opts: GitOptions = {}): Promise<void> {
  await runGit(['add', '-f', pathspec], opts);
}

/**
 * `git commit -m <subject> -m <body>` — commit the staged index with a
 * two-paragraph message. git joins the two `-m` values with a blank line,
 * producing `<subject>\n\n<body>`, so passing the parent commit's full body
 * as `body` forwards it verbatim into the new commit (the trailer-forward
 * the fold relies on so a `release:` trailer survives — see
 * notes/handoff/2026-04-24-dist-action.md).
 */
export async function commitWithBody(subject: string, body: string, opts: GitOptions = {}): Promise<void> {
  await runGit(['commit', '-m', subject, '-m', body], opts);
}

/* ------------------------------ tags ------------------------------ */

/**
 * The commit a tag points at. `rev-list -n 1` dereferences an annotated
 * tag down to the commit it ultimately references.
 */
export async function tagCommit(name: string, opts: GitOptions = {}): Promise<string> {
  return runGit(['rev-list', '-n', '1', name], opts);
}
