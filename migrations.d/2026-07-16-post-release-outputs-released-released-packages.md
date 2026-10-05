# Post-release outputs: `released` + `released_packages`

**Summary.** The reusable workflow (`release.yml`) now exposes two new
`workflow_call` outputs — `released` and `released_packages` — so a consumer
can run repo-defined work *when a release actually ships* and know *what*
shipped (issue #461). The motivating case is a fragment-based changelog
(towncrier): each PR drops a file under `changelog.d/`, and an assembly step
must render the accumulated fragments into a dated section — but only when a
release goes out, which for a putitoutthere consumer is "some push to main
that published ≥ 1 package," a moment only the release pipeline knows.
putitoutthere does not run your assembly logic (it runs no consumer-supplied
code in its pipeline — design non-goal #4); it emits the moment and the facts,
and you compose a downstream job on them, the same way the `pypi-publish` job
composes on `has_pypi`. `released` is `'true'` only when the run newly
published a package — an idempotent re-run whose versions are already live
reports `'false'` — making it a publish-time signal distinct from the
plan-time `has_pypi`. `released_packages` is a JSON array of
`[{name, version, tag}, …]` in publish order (`[]` when nothing shipped). The
engine's `publish` command writes both to `$GITHUB_OUTPUT`; the publish job
maps them to job outputs and the reusable workflow re-exports them, the same
two-hop wiring `has_pypi` already uses.

**Required changes.** None. Purely additive — existing callers that don't
read the new outputs are unaffected. To adopt, add a job to your own
`release.yml`:

| Before | After |
| --- | --- |
| (no post-release job; changelog assembled by a manually dispatched workflow that trails what shipped) | ```yaml
post-release:
  needs: release
  if: needs.release.outputs.released == 'true'
  runs-on: ubuntu-latest
  permissions: { contents: write }
  steps:
    - uses: actions/checkout@v7
    - env:
        RELEASED_PACKAGES: ${{ needs.release.outputs.released_packages }}
      run: your-tool assemble-changelog --shipped "$RELEASED_PACKAGES"
    - run: |
        git config user.name  "github-actions[bot]"
        git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
        git add CHANGELOG.md changelog.d/
        git commit -m "docs: assemble changelog" || exit 0
        git push
``` |

Keep the paths your `post-release` job commits (`CHANGELOG.md`,
`changelog.d/`) out of every package's `globs` so the write-back push plans
an empty matrix and does not loop; if a bookkeeping write must touch a
released path, add `[skip ci]` to its commit message instead. See
[README → Post-release bookkeeping](../README.md#post-release-bookkeeping).

**Deprecations removed.** None.

**Behavior changes without code changes.** None — the outputs are new. A
caller that already reads `has_pypi` sees no change to it; `released` /
`released_packages` are empty strings when the publish job is skipped (empty
plan), and populated otherwise.

**Verification.** After a release that publishes ≥ 1 package, the reusable
workflow's `release` job shows `released == 'true'` and `released_packages`
listing the shipped `{name, version, tag}` entries; a caller-side
`post-release` job gated on `needs.release.outputs.released == 'true'` runs.
A push that re-runs the pipeline with no new versions leaves `released` at
`'false'` and the job is skipped.

---
