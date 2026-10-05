# pypi: the git tag follows the upload

**Summary.** PyPI's upload runs in *your* workflow, not in
putitoutthere's reusable one — PyPI's Trusted Publisher matching filters
candidates by `repository_owner` / `repository_name` before checking
`job_workflow_ref`, so a token minted inside a cross-repo reusable
workflow never matches your TP record (pypi/warehouse#11096). The engine
nevertheless reported that handoff as `published` and cut the package's
git tag right then, before anything had been uploaded.

Any later failure in the run — a different registry, a different package
— failed the `publish` job, so your `pypi-publish` job (`needs: release`)
never ran. The result was a tag on your remote naming a distribution
nobody had uploaded, while PyPI 404'd. That state does not self-heal: the
next run reads "last released" from tags, sees the version as released,
and drops the package from the plan. Only deleting the tag by hand let a
re-run fix it. (The reverse case — a successful publish with no tag — has
always self-healed.)

Two changes, both in the template you paste:

1. The release job no longer tags a PyPI package. A new `pypi-tag` job,
   which runs after your `pypi-publish` job, cuts the tag — from what
   PyPI reports as live, so an upload that silently uploaded nothing is
   never recorded as a release, and a failed upload simply leaves the
   package untagged for the next run to re-attempt.
2. `pypi-publish` gates on the new `pypi_pending` output with
   `!cancelled()`, instead of on `has_pypi`. Registries are independent;
   a missing npm scope should not skip a PyPI upload whose artifacts are
   already built and validated. `pypi_pending` is publish-time and says
   "the engine reached your PyPI package and handed over its upload", so
   the upload proceeds when an unrelated registry fails, and is skipped
   when the run never got that far.

**Required changes.** Update `.github/workflows/release.yml` to the
current canonical template (README → Quickstart). If you publish nothing
to PyPI, the jobs stay skipped exactly as before, but paste them anyway —
the template is one artifact.

| | before | after |
| --- | --- | --- |
| `pypi-publish` gate | `if: needs.release.outputs.has_pypi == 'true'` | `if: ${{ !cancelled() && needs.release.outputs.pypi_pending == 'true' }}` |
| tagging a pypi package | the release job, at delegation time | a new `pypi-tag` job, after the upload |
| new job | — | `pypi-tag:` `needs: pypi-publish`, `uses: thekevinscott/putitoutthere/.github/workflows/pypi-tag.yml@v0`, `permissions: contents: write` |

Adopt both together. With only the gate change, a PyPI release never gets
tagged; with only the `pypi-tag` job, an unrelated registry's failure
still skips the upload it depends on.

**Deprecations removed.** None. `has_pypi` is unchanged and still
emitted — it remains the right answer to "does this repo publish to
PyPI?", it is simply the wrong gate for "is there an upload to perform?".

**Behavior changes without code changes.**

- A `kind = "pypi"` package's tag now appears when `pypi-tag` runs,
  seconds to a minute later than before, and never at all if the upload
  fails. Anything reading the tag as "the release finished" is now
  telling the truth.
- `released` / `released_packages` (#461) exclude PyPI packages: at the
  time the release job ends, a delegated package has not shipped. Hang
  post-release bookkeeping for a PyPI package off `needs: pypi-tag`
  instead.
- An idempotent re-run whose PyPI version is already live no longer runs
  `pypi-publish` at all (`pypi_pending` is `'false'`), where it used to
  re-download the artifacts and re-attempt an upload of files PyPI
  already had.
- `putitoutthere reconcile` now backfills a tag whenever the registry's
  live version has none — previously only when the package had no tags
  at all, which missed the steady-state case where the previous release
  is tagged and the newly uploaded version is not. A tag *ahead* of the
  registry is still left alone.
- If GitHub does not propagate the release job's outputs after that job
  fails, `pypi_pending` reads as empty and `pypi-publish` skips — the
  behaviour you had before this change, never worse.

**Verification.** Push a release that includes a PyPI package. The
release job's log says `<pkg>@<version> delegated; tag … is cut by the
job that performs the upload, not here`; `pypi-publish` uploads;
`pypi-tag` then reports `<pkg>: <version> live, no tag → created
<tag>`. `git fetch --tags && git tag -l '<pkg>-v*'` shows the tag only
after the upload succeeded. To see the fix on the failure path, re-run a
release where another registry is misconfigured: PyPI still uploads, and
`git tag -l` shows no tag for any version PyPI does not have.
