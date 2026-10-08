# verify: publish trust posture

**Summary.** New command `putitoutthere verify` reports, per package, how
its latest release authenticated to the registry — `oidc` (a
trusted-publisher / provenance attestation is present, so the long-lived
token can be dropped), `token` (no such attestation), `unpublished`, or
`unreachable`. Read from public registry trust attribution (crates.io
`trustpub_data`, npm provenance attestations, PyPI PEP 740 provenance) —
no secrets. `--check` exits non-zero on any token-dependent package, so a
team can gate CI on reaching the zero-secret OIDC steady state.

**Required changes.** None. Additive — a new command.

**Deprecations removed.** None.

**Behavior changes without code changes.** None — new surface.

**Verification.** Run `verify` on a repo whose packages publish via OIDC
trusted publishers: each shows `oidc` and `verify --check` exits zero. A
package last published with a long-lived token shows `token` and
`verify --check` exits non-zero. `--json` emits the same rows.
