# `publish` throws on empty matrix

**Summary.** `putitoutthere publish` previously logged
`publish: plan is empty; nothing to release` at info level and exited
0 when the matrix had no rows. The reusable workflow's `publish` step
went green on those runs even though nothing reached a registry —
visually indistinguishable from a successful release. The engine now
throws with code `PIOT_PUBLISH_EMPTY_PLAN`, the publish step exits
non-zero, and the run goes red. Skips remain a workflow-gate concern:
the canonical `release.yml` already has `if: …matrix output non-empty
…` on its publish job, so a `release: skip` trailer (or any other
empty-plan reason) skips the publish job rather than running it to a
no-op.

**Required changes.** None for consumers calling the reusable
workflow at `thekevinscott/putitoutthere/.github/workflows/release.yml@v0`.
The reusable workflow's existing `if:` on the publish job already
gates correctly. Hand-rolled workflows that invoked the CLI's
`publish` directly without a plan-output gate will now see a non-zero
exit on empty plans; add a gate or stop calling publish on commits
that don't produce work.

**Deprecations removed.** None.

**Behavior changes without code changes.** A release run that
reached the publish step with an empty plan used to log
`published: (nothing)` and exit 0; it now logs `[PIOT_PUBLISH_EMPTY_PLAN]
publish was invoked but the plan is empty…` to stderr and exits 1.
For repos whose release runs were silently no-op-ing (the dogfood
incident's failure mode), this surfaces the gap.

**Verification.** Trigger a release run that would produce an empty
plan (e.g. a commit that doesn't touch any package's `globs`) and
either bypass the workflow gate or invoke the CLI directly. Expect
exit 1, with `PIOT_PUBLISH_EMPTY_PLAN` in stderr. A healthy release
where the plan job's matrix is non-empty is unaffected.
