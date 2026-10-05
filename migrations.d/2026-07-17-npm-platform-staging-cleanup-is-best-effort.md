# npm-platform staging cleanup is best-effort

**Summary.** The npm platform-package publish loop (`build = "napi"` /
`build = "bundled-cli"`) previously `await`ed the staging-tempdir `rm`
inside a `finally`, where a cleanup rejection replaces the `try` block's
outcome. On a runner where `rm` can fail even with `force: true`
(`EBUSY` / `EPERM` on Windows), a platform package that had *already*
published to npm surfaced to the caller as a publish failure — masking a
real success and contradicting the all-or-nothing-per-package guarantee.
Cleanup is now best-effort: the `rm` is wrapped in its own `try`/`catch`
that swallows the failure and logs a warning, so a successful publish
stays reported as such.

**Required changes.** None. This is internal to the engine's npm
platform-publish path; no config, CLI flag, or workflow input changes.

**Deprecations removed.** None.

**Behavior changes without code changes.** A post-publish staging-cleanup
failure is no longer fatal. Where such a failure would previously abort
the platform-publish step (and, because the publish had already landed,
strand the release in a partially-reported state), the engine now emits a
`warn`-level log line naming the staging directory it could not remove and
continues — the platform package is counted as published and the main
package's `optionalDependencies` rewrite proceeds.

**Verification.** In a release that publishes npm platform packages, a
transient cleanup failure now shows up as a `failed to clean up platform
staging directory …` warning in the job log rather than a failed publish
step; the platform package is present on the registry and the run
succeeds.
