# Crates first-publish TP rejection detected

**Summary.** crates.io's Trusted Publishing feature binds to an
already-published crate name. The very first publish of a brand-new
crate cannot use the TP path — the OIDC mint succeeds, the exchanged
token reaches cargo, but the registry rejects the publish with a 404
("crate `<name>` does not exist or you do not have permission to
publish to it"). The engine previously surfaced this as a generic
`cargo publish failed` block, sending consumers down a credentials
rabbit-hole when the real fix is one bootstrap publish via the
classic-token fallback shipped in #283.

The crates handler now detects this exact response shape and throws
with the new stable error code
`PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED`, prefixed onto a message
that names the crate, explains the TP-binds-to-published-crate
constraint, and points at `CARGO_REGISTRY_TOKEN` as the bootstrap
path. Cargo's full stderr is preserved at the bottom of the error
for debuggability. Companion work landed a registry-auth response
fixtures catalogue at
[`notes/upstream-behaviors.md`](../notes/upstream-behaviors.md) that
indexes this and three other response shapes the engine handles or
architecturally avoids — see #296.

**Required changes.** None. Consumers who never hit the
first-publish path see no change. Consumers whose first release
fails on a brand-new crate now see a clearer error pointing at the
fix; the fix itself (set `CARGO_REGISTRY_TOKEN` as a workflow
secret for one publish, then remove it) has been available since
#283 and is unchanged.

**Deprecations removed.** None.

**Behavior changes without code changes.** A `cargo publish`
failure whose stderr matches the first-publish-TP-rejection shape
now throws with `PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED` instead of
the generic `cargo publish failed` shape. The full cargo stderr
remains in the error message. The detector is suppressed under the
`PIOT_CRATES_REGISTRY_PRIMARY` e2e seam (alt-registry doesn't model
TP, so a 404 there is a different bug).

**Verification.** On a brand-new crate name where Trusted
Publishing is the only auth configured, run the release. The
release run fails with a message starting
`[PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED] cargo publish: crates.io
rejected publishing "<name>" because the crate has never been
published.` followed by the bootstrap hint. Set
`CARGO_REGISTRY_TOKEN` in the workflow's `secrets:` block (per
#283), re-run, and the publish should succeed. Subsequent releases
can drop the secret and rely on Trusted Publishing.
