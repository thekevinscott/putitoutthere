# reconcile --expect waits for PyPI to catch up (#777)

**Summary.** `reconcile --expect`, which the `pypi-tag` job runs right after `pypi-publish`, read PyPI's per-version endpoint once. That endpoint can 404 for minutes after an upload, so the job failed, no tag was cut, and the next release planned the same version again. It now re-reads the endpoint for up to about 3 minutes before failing.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** The `pypi-tag` job can take up to about 3 minutes longer, only while PyPI has not caught up. Each retry logs `<name>@<version> not visible on the registry yet; retrying in Ns`. A version that never appears still fails the job with `reconcile --expect: <name>@<version> not found on the pypi registry`, now after the wait instead of at once.

**Verification.** A release whose `pypi-tag` job used to fail with `not found on the pypi registry` now passes and pushes the `<name>-v<version>` tag, possibly after a few retry lines in its log.
