# v0 tracks main HEAD

**Summary.** Until this release, the floating `v0` tag advanced only
when a `release:` trailer fired the dogfood publish pipeline
(`release-npm.yml`), which then moved `v0` to the latest
`putitoutthere-v0.x.y` release commit. Commits that landed on main
without a trailer — test-only changes, docs edits, dependency bumps,
internal refactors, and one-off bug fixes whose author forgot the
trailer — left `v0` stale relative to main. The behavior was
explicitly chosen in issue #199 (`v0` = "latest released commit in
major line") and is now explicitly reversed: `v0` tracks main HEAD,
not the latest release.

A new workflow `.github/workflows/advance-v0.yml` fires on every
push to main, builds the action bundle, folds it into a tag-only
commit (mirroring `release-npm.yml`'s existing Fold step —
`dist-action/` is gitignored on main, so `v0` must point at a
synthesized bundle commit for `uses:
thekevinscott/putitoutthere@v0` to resolve to a runnable action),
and force-moves `v0` to that commit. The new workflow shares the
`release` concurrency group with `release-npm.yml`, so when both
fire on the same push (a trailer-bearing commit), the registry
publish runs first and `v0` is then advanced on top.

The permanent per-release tags (`putitoutthere-v0.x.y`) are
unchanged — they're cut by the dogfood publish pipeline on
trailer-fire and remain the canonical version history.

**Required changes.** None on the consumer side. The change is in
how `@v0` resolves over time, not in what the workflow at that ref
does.

**Deprecations removed.** None.

**Behavior changes without code changes.** A commit that lands on
`main` of `thekevinscott/putitoutthere` is, on the next consumer
workflow resolve, the workflow code the consumer runs. Previously
consumers had to wait for a release to be cut to pick up engine
changes; now they pick them up on the next push to main. Consumers
who want pinning to a known-released version use a
`putitoutthere-v0.x.y` tag (or a SHA) instead of `@v0`.

**Verification.** After this change merges and the first push to
main fires `advance-v0.yml`, the `v0` tag points at a fresh bundle
commit whose parent is the merge commit on main. Confirm with:

```
$ git ls-remote --tags https://github.com/thekevinscott/putitoutthere.git v0
<sha>  refs/tags/v0
$ git log <sha> -1 --format='%H %s'
<sha> chore(v0): bundle action
$ git log <sha>^ -1 --format='%H %s'   # parent is the merge commit on main
<parent-sha> <merge commit subject>
```
