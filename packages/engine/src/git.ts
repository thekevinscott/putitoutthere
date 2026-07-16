/**
 * Thin wrapper around the `git` CLI for the ops putitoutthere needs.
 *
 * Stderr is captured and surfaced in thrown errors so failures are
 * diagnosable without re-running with --verbose.
 *
 * Issue #9. Plan: §13.6 (no-push tag model), §14.2 (last-tag resolver).
 */

import { execCapture } from './utils/exec-capture.js';
import { ExecError } from './utils/exec-error.js';
import { parseTagVersion, tagGlob } from './tag-template.js';
import { parseSemver, type Semver } from './version.js';

export interface GitOptions {
  cwd?: string;
}

interface TagOptions extends GitOptions {
  message?: string;
}

/* ------------------------------ core ------------------------------ */

async function run(args: string[], opts: GitOptions = {}): Promise<string> {
  try {
    return (await execCapture('git', args, { cwd: opts.cwd })).stdout.trimEnd();
  } catch (err) {
    // execCapture rejects with an ExecError whose `stderr` field carries
    // git's error output (already a string). Fold it into the thrown
    // message so tests + logs see the root cause without separate plumbing.
    const stderr = err instanceof ExecError ? err.stderr.trim() : undefined;
    const base = err instanceof Error ? err.message : String(err);
    // `git tag -a` on a runner with no user.name/email surfaces as
    // "Please tell me who you are" / "unable to auto-detect email
    // address". Give the adopter an actionable hint instead of the
    // bare git output. #206.
    const needsIdentity =
      stderr !== undefined &&
      /unable to auto-detect email address|Please tell me who you are/.test(stderr);
    if (needsIdentity) {
      throw new Error(
        [
          `git ${args[0] ?? ''}: no committer identity configured.`,
          'piot cuts annotated tags which require `user.name` + `user.email`.',
          'Configure them in the publish job before invoking piot:',
          '  - run: |',
          '      git config --global user.name "github-actions[bot]"',
          '      git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"',
          'See https://thekevinscott.github.io/putitoutthere/guide/runner-prerequisites',
          '',
          `Underlying git output:\n${stderr}`,
        ].join('\n'),
        { cause: err },
      );
    }
    throw new Error(stderr ? `${base}\n${stderr}` : base, { cause: err });
  }
}

/* ---------------------------- observers ---------------------------- */

export async function headCommit(opts: GitOptions = {}): Promise<string> {
  return run(['rev-parse', 'HEAD'], opts);
}

export async function commitBody(sha: string, opts: GitOptions = {}): Promise<string> {
  // %B = raw body (subject + body, no trailer folding).
  return run(['log', '-1', '--format=%B', sha], opts);
}

export async function commitParents(sha: string, opts: GitOptions = {}): Promise<string[]> {
  // %P = parent SHAs, space-separated. Merge commits have ≥2;
  // plain commits have 1; root commits have 0.
  const out = await run(['log', '-1', '--format=%P', sha], opts);
  if (out === '') {return [];}
  return out.split(' ').filter((s) => s.length > 0);
}

export async function diffNames(
  from: string,
  to: string,
  opts: GitOptions = {},
): Promise<string[]> {
  const out = await run(['diff', '--name-only', `${from}..${to}`], opts);
  if (out === '') {return [];}
  return out.split('\n').filter((l) => l.length > 0);
}

/* ------------------------------ tags ------------------------------ */

export async function tagList(glob: string, opts: GitOptions = {}): Promise<string[]> {
  const out = await run(['tag', '-l', glob], opts);
  if (out === '') {return [];}
  return out.split('\n').filter((l) => l.length > 0);
}

export async function createTag(
  name: string,
  sha: string,
  opts: TagOptions = {},
): Promise<void> {
  const message = opts.message ?? name;
  await run(['tag', '-a', '-m', message, name, sha], opts);
}

export async function pushTag(name: string, opts: GitOptions = {}): Promise<void> {
  await run(['push', 'origin', name], opts);
}

/**
 * `git fetch --tags --force origin` — refresh every remote tag, forcing
 * updates for tags that moved on the remote. The `--force` is load-bearing
 * (#199): without it a tag the remote force-moved since checkout is
 * rejected as a non-fast-forward, failing the fetch. Used before the
 * floating-major-tag move re-derives "latest release" from local tags.
 */
export async function fetchTagsForce(opts: GitOptions = {}): Promise<void> {
  await run(['fetch', '--tags', '--force', 'origin'], opts);
}

/**
 * `git tag -f <name> <target>` — create or move a lightweight tag to
 * `target`, overwriting an existing tag of the same name. The local half of
 * a floating-tag move; pair with `pushTagRefForce` to publish it.
 */
export async function forceTag(name: string, target: string, opts: GitOptions = {}): Promise<void> {
  await run(['tag', '-f', name, target], opts);
}

/**
 * `git push --force origin refs/tags/<name>` — force-publish a single moved
 * tag, ref-scoped so it is invisible to every other tag. The remote half of
 * a floating-tag move: unlike `pushTagRef` (which fails on a non-fast-
 * forward), this overwrites the remote tag, which floating tags require.
 */
export async function pushTagRefForce(name: string, opts: GitOptions = {}): Promise<void> {
  await run(['push', '--force', 'origin', `refs/tags/${name}`], opts);
}

/**
 * The tags whose commit is HEAD — `git tag --points-at HEAD`. Lists exactly
 * the tags the engine just created on this commit, with no fetch and no
 * remote dependency (#444). Empty array when HEAD carries no tag.
 */
export async function tagsPointingAtHead(opts: GitOptions = {}): Promise<string[]> {
  const out = await run(['tag', '--points-at', 'HEAD'], opts);
  if (out === '') {return [];}
  return out.split('\n').filter((l) => l.length > 0);
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
  await run(['push', 'origin', `refs/tags/${name}`], opts);
}

/* ---------------------------- staging ---------------------------- */

/**
 * `git add -f <pathspec>` — stage `pathspec`, overriding `.gitignore`. The
 * action bundle (`dist-action/`) is gitignored on main and exists only on
 * tag commits, so folding it in requires the force flag.
 */
export async function addForce(pathspec: string, opts: GitOptions = {}): Promise<void> {
  await run(['add', '-f', pathspec], opts);
}

/**
 * Whether the index holds staged changes — `git diff --cached --quiet`
 * exits non-zero when there are. Returns `true` when something is staged,
 * `false` on a clean index. Used to guard the fold against committing
 * nothing when `build:action` produced no bundle output.
 */
export async function hasStagedChanges(opts: GitOptions = {}): Promise<boolean> {
  try {
    await run(['diff', '--cached', '--quiet'], opts);
    return false;
  } catch {
    return true;
  }
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
  await run(['commit', '-m', subject, '-m', body], opts);
}

/* ------------------------------ tags ------------------------------ */

/**
 * The commit a tag points at. `rev-list -n 1` dereferences an annotated
 * tag down to the commit it ultimately references.
 */
export async function tagCommit(name: string, opts: GitOptions = {}): Promise<string> {
  return run(['rev-list', '-n', '1', name], opts);
}

/* -------------------------- last-tag resolver -------------------------- */

/**
 * Find the highest-semver tag for a given package.
 *
 * Tag shape comes from the package's `tag_format` template (default
 * `{name}-v{version}`). We glob-filter, parse each candidate against
 * the template, and return the highest. Malformed candidates that
 * match the glob but not strict semver are skipped silently — they're
 * operator noise, not tool output.
 *
 * Returns null when no tag for this package exists.
 */
export async function lastTag(
  packageName: string,
  tagFormat: string,
  opts: GitOptions = {},
): Promise<string | null> {
  const candidates = await tagList(tagGlob(tagFormat, packageName), opts);

  let best: { tag: string; version: Semver } | null = null;
  for (const tag of candidates) {
    const versionPart = parseTagVersion(tagFormat, packageName, tag);
    if (versionPart === null) {continue;}
    let parsed: Semver;
    try {
      parsed = parseSemver(versionPart);
      /* v8 ignore next 3 -- parseTagVersion already validated semver; defensive */
    } catch {
      continue;
    }
    if (!best || greater(parsed, best.version)) {
      best = { tag, version: parsed };
    }
  }
  return best?.tag ?? null;
}

function greater(a: Semver, b: Semver): boolean {
  /* v8 ignore next 2 -- comparison branches not all reachable from current test data */
  if (a.major !== b.major) {return a.major > b.major;}
  if (a.minor !== b.minor) {return a.minor > b.minor;}
  return a.patch > b.patch;
}
