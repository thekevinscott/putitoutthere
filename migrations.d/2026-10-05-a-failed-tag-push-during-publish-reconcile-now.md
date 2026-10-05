# A failed tag push during `publish`/`reconcile` now fails the job (#717)

**Summary.** `ensureTag` — the auto-heal that writes and pushes the git
tag for a version confirmed live on a registry (#407) — caught any
failure from `git push` and downgraded it to a log warning, then
returned as if nothing had happened. `publish` and `reconcile` exited
`0` with the version live on the registry and no tag pointing at it;
piot derives "last released" from tags, so the package was stranded by
a run that reported success.

The idempotency check guarding re-tagging also only looked at local
tags (`git tag -l`), not the remote. A run that created the tag locally
and then failed to push it left that local tag behind, and every later
run in the same working tree read it as "already done" and never
retried the push — "tried and failed" was indistinguishable from
"succeeded" for the rest of that tree's life. A fresh CI checkout never
hit this (no prior local tags to read), which is why it went unnoticed;
it bites a reused working tree instead.

Both are fixed together: `ensureTag` now asks `origin` directly
(`git ls-remote --tags`) before doing anything, skips re-creating the
tag only when a *local* copy already exists (so a half-finished retry
does not hit "tag already exists"), and lets a push failure propagate
as a thrown error instead of a warning — tagged
`[PIOT_TAG_PUSH_FAILED]`, with the original git error attached as
`.cause` and a message stating plainly that the registry write already
happened, so the fix is `putitoutthere reconcile`, not re-running
`publish`.

**Required changes.** None. No config key, workflow input, or trailer
changes; a run whose tag push succeeds — the overwhelming common case,
since a real CI checkout always has a reachable `origin` — behaves
exactly as before.

**Deprecations removed.** None.

**Behavior changes without code changes.** A `publish` or `reconcile`
run that fails to push a tag — unreachable `origin`, a permissions
problem, a protected-tag rule, a diverged remote tag — now exits
non-zero instead of `0`, with a `[PIOT_TAG_PUSH_FAILED]` error naming
the package, version, and tag, and chaining the underlying git error.
Previously this was a `publish: failed to push tag ...` warning in the
log with no effect on the exit code.

**Verification.** Point a repo's `origin` at an unwritable remote (or
remove it) and run `publish`/`reconcile` against a package whose
version is live but untagged. Before: the command logs a warning and
exits `0` with no tag written. After: the command exits non-zero with a
`[PIOT_TAG_PUSH_FAILED]` error naming the package and version.
