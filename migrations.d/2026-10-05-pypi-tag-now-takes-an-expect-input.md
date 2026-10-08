# `pypi-tag` now takes an `expect` input (#694)

**Summary.** `pypi-tag` cut the tag for whatever PyPI reported as a
package's *latest version*. That answer comes from the project-level
`GET /pypi/{name}/json` endpoint, which is CDN-cached for 15 minutes and
eventually consistent — and for a project whose first release has not
propagated yet, it returns **404**. A 404 there is also the correct,
permanent answer for a project that was never released, so the two are
indistinguishable, and `pypi-tag` runs seconds after your upload. The
engine read the 404, concluded the package was unpublished, and exited
`0` having done nothing: the tag was silently never written. Observed
twice on a real consumer's `agent-transcript-viewer 0.0.0`.

No retry fixes this — there is no budget that separates "not propagated
yet" from "does not exist", and the cache header puts a reliable one at
15 minutes of a job sleeping. So `pypi-tag` stops guessing and is told
instead. The release job already computed exactly the `{name, version,
tag}` rows it handed your `pypi-publish` job; that list is now exposed
as the `delegated_packages` output, and `pypi-tag` takes it as a new
`expect` input. Given it, the engine confirms each named version against
PyPI's **immutable** per-version endpoint (`/pypi/{name}/{version}/json`),
which is never stale for a version that exists, and tags it. If a named
version genuinely is not on PyPI, the job now **fails** rather than
passing silently — re-run it once the upload is really there.

**Required changes.** Update the `pypi-tag` job in your
`.github/workflows/release.yml` (README → Quickstart has the current
canonical template). Three edits to one job:

| | before | after |
| --- | --- | --- |
| `needs` | `needs: pypi-publish` | `needs: [release, pypi-publish]` |
| gate | — | `if: ${{ !cancelled() && needs.pypi-publish.result == 'success' }}` |
| input | — | `with:`<br>`  expect: ${{ needs.release.outputs.delegated_packages }}` |

```yaml
  pypi-tag:
    needs: [release, pypi-publish]
    if: ${{ !cancelled() && needs.pypi-publish.result == 'success' }}
    uses: thekevinscott/putitoutthere/.github/workflows/pypi-tag.yml@v0
    permissions:
      contents: write
    with:
      expect: ${{ needs.release.outputs.delegated_packages }}
```

All three are load-bearing. `release` has to be in `needs` for
`needs.release.outputs` to resolve at all — and because adding it would
otherwise make the job require the release job to *succeed*, the explicit
`if:` restores the #623 behaviour where a failure on an unrelated
registry still lets your PyPI upload, and its tag, go through. Omitting
`expect` is not an error: the job falls back to the old discovery path,
which is exactly the race this section exists to remove.

**Deprecations removed.** None. `pypi_pending` is unchanged and still
emitted; `delegated_packages` is the same set as a list rather than a
boolean, so keep gating `pypi-publish` on `pypi_pending`.

**Behavior changes without code changes.**

- A PyPI **first publish** is now tagged. Previously its tag was
  silently skipped and the next run, reading "last released" from tags,
  planned the same version again.
- `pypi-tag` can now **fail**. It asserts the versions the release run
  delegated are on PyPI; if one is not, the job exits non-zero instead of
  reporting nothing to do. A re-run after the upload lands is the fix —
  tagging stays idempotent.
- `reconcile`'s JSON result gains a `skipped` array
  (`[{package, kind, reason}]`) listing packages whose registry could not
  be read, and emits one `::warning::` annotation per entry. The command
  still exits `0` for those: it walks every configured package, so a
  crates.io outage must not fail your PyPI tagging job. A package that is
  merely unpublished is **not** listed — a registry answering "no such
  version" has answered.
- With `expect` set, `pypi-tag` no longer reads the project-level
  "latest version" endpoint at all, so it also no longer tags an
  *unrelated* newer version that happened to be live on PyPI when it ran.

**Verification.** Release a brand-new PyPI package (a project with no
prior release — the case that was broken). After `pypi-publish`
succeeds, the `pypi-tag` job log reports `<pkg>: <version> live, no tag
→ created <pkg>-v<version>`, and `git fetch --tags && git tag -l
'<pkg>-v*'` shows it. Before this change the same job logged
`reconcile: created 0 tag(s)` and exited green with no tag. To see the
new loud-failure path, pass `expect` a version that is not on PyPI
(`expect: '[{"name":"<pkg>","version":"999.999.999"}]'` in a scratch
branch): the job fails naming the unconfirmed version instead of
silently succeeding.
