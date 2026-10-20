# pypi-tag cuts the GitHub Release for a PyPI package (#798)

**Summary.** A PyPI package's tag is cut by the `pypi-tag` job after the caller's upload (#623). `release.yml`'s Release step had already run by then and found no tag on HEAD, so a PyPI package never got a GitHub Release. `pypi-tag.yml` now cuts the Release itself, right after it writes the tag.

**Required changes.** None. The `pypi-tag` job already grants `contents: write`, which `gh release create` needs.

**Deprecations removed.** None.

**Behavior changes without code changes.** The `pypi-tag` job now ends with a `Create GitHub Release(s) for new tag(s)` step. It releases every tag on the run's commit that has no Release yet and skips those that do. Tags `reconcile` backfills on older commits still get no Release.

**Verification.** After the next release of a PyPI package, the repository's Releases page lists `<name>-v<version>`, and the `pypi-tag` job log shows `Created GitHub Release for <name>-v<version>`.
