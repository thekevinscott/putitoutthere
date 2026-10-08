# Crates Cargo.toml must declare `description` and `license`

**Summary.** Every cascaded `kind = "crates"` package's `Cargo.toml`
must now declare `[package].description` and either `[package].license`
or `[package].license-file`. The new preflight check
(`requireCratesMetadata` in `src/preflight.ts`) runs in
`src/publish.ts` immediately after `requireProvenanceMetadata` and
rejects the run with `PIOT_CRATES_MISSING_METADATA` before any
runner work. Why: crates.io rejects publish with `400 Bad Request:
missing or empty metadata fields: ...` after `cargo publish`'s
verification build has compiled the crate and every transitive dep
— wasting the entire publish job (often a minute+ of compile time
plus the upload) on a precondition checkable in milliseconds. Hit
in the wild on `thekevinscott/darkfactory`'s first crate publish;
tracked in #290. Same shape as #280 (npm `repository`).

**Required changes.** Add the two fields to every Cargo.toml
declared as `kind = "crates"` in `putitoutthere.toml`.

| Before                                                                                  | After                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[package]`<br>`name = "lib"`<br>`version = "0.1.0"`<br>`edition = "2021"`              | `[package]`<br>`name = "lib"`<br>`version = "0.1.0"`<br>`edition = "2021"`<br>`description = "One-line summary."`<br>`license = "MIT OR Apache-2.0"`                                   |

`license-file = "LICENSE"` is accepted as a substitute for
`license` (the SPDX expression form). Whitespace-only values
(`description = "   "`) are treated as empty.

No `release.yml` or `putitoutthere.toml` changes are required.

**Deprecations removed.** None.

**Behavior changes without code changes.** `putitoutthere publish`
now fails fast at preflight with
`[PIOT_CRATES_MISSING_METADATA] cargo publish requires the
following Cargo.toml [package] fields: description, and license
(or license-file).` for any cascaded crates package whose
Cargo.toml lacks the fields. Previously the same shape ran
through plan + auth-negotiation + ~30s of cargo verification
build and failed inside `cargo publish` with a 400 from
crates.io. Well-formed packages are unaffected.

The error message names every failing package, its `Cargo.toml`
path, and the specific missing fields, so consumers fix all of
them in one round-trip rather than discovering them one at a
time across multiple release attempts.

**Verification.** Drop `description` from one of your Cargo.toml
files locally and run `pnpm test:integration` (or the engine
against a local fixture); the failure should arrive at preflight
with `PIOT_CRATES_MISSING_METADATA` in the message, no crate
should be published, and no git tag should be created. Restore
the field; the next run completes normally.

---
