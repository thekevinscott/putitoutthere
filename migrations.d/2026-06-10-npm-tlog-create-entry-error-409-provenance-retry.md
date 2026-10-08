# npm `TLOG_CREATE_ENTRY_ERROR` (409) provenance retry race

**Summary.** `kind = "npm"` releases that publish with provenance
(`--provenance`, the OIDC trusted-publisher path) could abort mid-matrix
when npm's internal retry-on-transient-network-error re-submitted a
byte-identical attestation and Sigstore/Rekor rejected the duplicate with
`TLOG_CREATE_ENTRY_ERROR` (HTTP 409, "an equivalent entry already exists in
the transparency log"). Only the registry-PUT edition of that race (the
`E403` "cannot publish over the previously published versions" shape) was
tolerated; the attestation edition fell through to a hard failure, which
for a multi-platform (`napi` / `bundled-cli`) package left the remaining
sub-packages and the main package unpublished — a partial release. The
engine now recognizes the 409 and, because a 409 from Rekor does not by
itself prove the artifact reached the registry, re-probes `npm view` to
decide: present ⇒ benign duplicate (success); absent ⇒ a genuine partial
publish, reported as an actionable error.

**Required changes.** None. The behavior is automatic and applies to every
`kind = "npm"` package; no `putitoutthere.toml`, `release:` trailer, or
reusable-workflow input changes.

**Deprecations removed.** None.

**Behavior changes without code changes.** A `kind = "npm"` publish that
hits `TLOG_CREATE_ENTRY_ERROR` (409) no longer fails unconditionally:

| Situation | Before | After |
|-----------|--------|-------|
| 409 raised, package **is** on the registry | publish job fails (`npm publish (platform) failed: …`) | treated as `already-published` / counted as published; the cascade continues |
| 409 raised, package is **absent** from the registry | publish job fails with a bare npm stderr dump | publish job still fails, but with an actionable message: re-run the release to mint a fresh attestation |

In the genuine partial-publish case the engine cannot recover in-process —
an orphaned attestation needs a new `runID`/attempt to produce a fresh
Rekor entry — so re-running the release is the documented remedy.

**Verification.** Re-run a release whose previous attempt died on
`TLOG_CREATE_ENTRY_ERROR`. If the sub-package already landed, the run now
reports it as already-published and proceeds to the remaining packages
instead of aborting; if it never landed, the error names the package and
tells you to re-run (which mints a new attestation and gets past the
dedupe).
