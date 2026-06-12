# Previewing the plan, and recovering when a release goes sideways

Two real first-release sessions produced the lessons in this file. They share
one root discipline: **on irreversible actions, verify from authoritative
state — never infer.** Every expensive detour in both sessions was something a
quick authoritative check would have killed.

## Preview exactly what will release — before you merge

The single most expensive recorded mistake was confidently calling a merge a
"no-op release" — and being wrong. The agent reasoned "the version is already
published, so nothing will release." That is the wrong question. The planner
never asks "is this version published"; it asks **"did a file matching this
package's globs change since this package's last tag?"** Reason from globs and
tags, never from registry state.

So never assert what a merge will publish. Get it from an authoritative
dry-run:

- **`plan`** — putitoutthere's plan/dry-run surface (being built). Run it (or
  read its output) to get the exact `{package → version}` rows a merge would
  produce. This is the authoritative answer; prefer it when available.
- **`build-check.yml` on the PR** — runs the *same* plan + build matrix a
  release runs, with the publish job structurally absent (no `id-token`, no
  registry auth — the publish bytes don't exist on that path). The plan it
  computes is what a release from this commit would publish. Reading that run
  is a publish-free preview that is always available.

Then state the predicted plan back to the user — "merging this publishes
my-rust 0.1.0 and my-py 0.1.0; my-cli is unchanged" — and confirm before
merging.

### How the planner decides (so you can sanity-check the preview)

- **Very first release — no tags exist yet.** Every declared package is
  force-cascaded and ships at its `first_version` (default `0.1.0`). Globs do
  **not** gate the first release — expect *everything* to publish on run one.
  Confirm every package is actually ready to ship.
- **Every release after.** A package is planned only if a committed file
  matching **its own** `globs` changed since **its own** last tag — plus any
  package that `depends_on` a cascaded one, plus any package named in a
  `release:` trailer.
- **Default bump is `patch`.** A `release: minor|major [pkgs]` trailer in the
  merge commit changes it (scoped to the listed packages, or all cascaded if
  unscoped). `release: skip` plans nothing.
- **Trailer location follows merge strategy.** The planner reads HEAD's commit
  body; if HEAD is a merge commit with no trailer, it falls back to the merged
  branch tip. Squash-merge collapses everything into one commit (put the
  trailer there); a merge commit needs the trailer on the branch tip.
- **Changes outside every glob release nothing.** A commit touching only
  `.github/workflows/**`, root docs, etc. matches no package's globs → empty
  plan → no release. That can be correct — but confirm it's *intended* by
  reading the plan, not by guessing.

## First releases stress the whole toolchain — expect a cascade

A first release is an end-to-end integration test of config + manifests + the
engine + every registry. One recorded session hit **five** separate failures,
each masking the next (every run died upstream of the following bug). That is
normal, not bad luck. Work it methodically:

- **Each failure is usually real, not a flake.** A registry 4xx, a launcher
  error, a wheel collision — treat them as genuine until proven otherwise.
  Root-cause from the run log and artifacts, not a guess.
- **Grep the run log for the `PIOT_*` code and look it up.** The authoritative
  list is `src/error-codes.ts` in putitoutthere (the README table is a subset).
  Each code's comment names the exact mechanism and the fix.
- **Re-running is safe.** Every handler's first publish move is an `isPublished`
  check, so a re-run skips already-published versions cleanly. Fix and re-run
  without fear of double-publishing.
- **Read authoritative status before declaring success.** "The build looks
  green" / "it probably published" were repeated misses. Check the run's actual
  conclusion, the registry API, and the git tags — and don't say "done" until
  all three agree.

## The PyPI partial-tag trap (the most repeated friction)

PyPI publishes in **two phases that can disagree**:

1. The engine's `publish` job builds the wheels/sdist **and creates the git
   tag**.
2. Your caller-side `pypi-publish` job uploads to PyPI **afterward**
   (`needs: release`).

If phase 2 fails (a bad wheel, a `twine` error) after phase 1 has tagged, you
get a **tag with no artifact on PyPI**. The next run then sees the package
already tagged, finds no new glob changes, and **excludes it from the plan** →
`has_pypi=false` → `pypi-publish` is skipped → the package is stuck empty while
its tag claims success.

Recognize it: the git tag (and GitHub Release) exist, but `pip install
<pkg>==<version>` 404s and the PyPI project is empty.

Recover with the **`release_packages` manual override at a bumped version** —
the clean path:

```
Actions → Release → Run workflow
release_packages = my-py@0.0.2
```

`release_packages` bypasses change detection and releases exactly the named
packages; an explicit version is used verbatim (not compared to the last tag),
forcing a fresh, clean publish of just the stuck package. Bumping past the
stranded tag beats deleting the tag — tag deletion is often blocked in
scoped/agent environments (below), and a superseded partial version is
harmless. This same override is the tool for any "re-release after fixing a
pipeline bug."

## Environment limits to plan around (remote / scoped agents)

- **Git access may be branch-scoped.** Pushing a tag, or pushing to any branch
  other than your working branch, can return `403`. Tag backfills/deletions
  then fall to the user — or sidestep them with the `release_packages` bump,
  which needs no tag surgery. Assume tag pushes won't go through; route them to
  the user instead of burning a cycle discovering it.
- **API commits may be unsigned.** If branch protection requires signed
  commits, commits made through the GitHub API can be rejected as unsigned even
  when local `git` commits are fine. Prefer the git path; verify signature
  state rather than assuming the API signs.
- **`@v0` is a moving tag.** The reusable workflow's behavior can change between
  two runs of the same repo. If a run behaves differently than before, the
  engine moving under you is a real possibility — re-read current behavior
  rather than trusting last week's.

## Names and first publishes are permanent

A crates.io or npm name, once published, is effectively yours forever — no
clean rename or reclaim. Scaffolds and templates leave placeholder names (a
stray `-cli` suffix, the template's own name) that would ship permanently if
not caught — a near-miss in one session almost put template names on crates.io
for good. Before the first publish, confirm every registered name is the final
intended one. This is a "confirm before irreversible" gate, not a formality.
