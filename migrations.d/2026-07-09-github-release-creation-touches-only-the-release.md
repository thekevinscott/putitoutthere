# GitHub Release creation touches only the release's own tags

**Summary.** The reusable workflow's `Create GitHub Release(s) for new
tag(s)` step no longer runs a blanket `git fetch --tags origin`, and now
pushes each of the release's tags ref-scoped (`git push origin
"refs/tags/$tag"`, idempotent) before `gh release create`. Previously the
un-forced fetch coupled the step to the state of **every** tag in the
consumer's repo: a floating major tag (e.g. `v0`) force-moved mid-run by
the consumer's own promotion automation failed the publish job with
`! [rejected] v0 -> v0 (would clobber existing tag)` *after* every
registry publish and per-package tag push had succeeded — and because
consumer automation gates promotion on this job's conclusion, the release
was published but never promoted, with no safe job-level rerun (the
replayed publish re-plans against the already-pushed tags and hard-fails
on an empty plan). Observed twice in two days on
thekevinscott/testing-conventions (#436). The ref-scoped push also
completes the engine's deliberately warn-only tag push (#407) within the
same run, closing the second observed variant (`tag ... exists locally
but has not been pushed`).

**Required changes.** None. The step is workflow-internal; no config,
input, or consumer-side YAML changes.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- A publish run no longer fails when any tag it does not own (a floating
  major tag, another run's tags) moves between checkout and Release
  creation.
- A per-package tag that the engine created but could not push (its push
  is warn-only, #407) is now pushed by this step in the same run, so the
  GitHub Release is cut instead of the job failing one step later.
- A genuine conflict — the same version tag already on the remote at a
  *different* commit — still fails loudly at the ref-scoped push. That
  means two runs released the same version, which the
  `putitoutthere-release-*` concurrency group exists to prevent.

**Verification.** Land two release-triggering pushes to `main` a few
minutes apart in a repo whose promotion automation force-moves a floating
major tag on release success (the thekevinscott/testing-conventions
shape): the second run's publish job completes green and its GitHub
Releases exist, where it previously failed at `Create GitHub Release(s)
for new tag(s)`. On any release run's log, the step shows a per-tag
`git push origin "refs/tags/<tag>"` and no `git fetch`.
