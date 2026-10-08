# npm bundled-cli binary embeds the release version

**Summary.** The reusable workflow's npm `build = "bundled-cli"` path
cross-compiled the bundled CLI from un-rewritten crate source, so the
binary's `CARGO_PKG_VERSION` (what `<bin> --version` prints) was baked
from the literal `[package].version` in the crate's `Cargo.toml`
rather than the planned release version. A `@scope/cli-<triple>@0.3.5`
platform package could ship a binary that reported `0.2.7`. The build
matrix now rewrites the crate's `[package].version` to `matrix.version`
before `cargo build` runs, mirroring the pre-build `write-version`
step the pypi/maturin path already uses.

**Required changes.** None. The fix lives entirely inside the reusable
workflow's build matrix. Consumers who declare a `kind = "npm"`
`build = "bundled-cli"` package with `[package.bundle_cli]` get the
corrected behavior on their next release run against `@v0`; no
`putitoutthere.toml`, trailer, or consumer-side YAML change is needed.

**Deprecations removed.** None.

**Behavior changes without code changes.** Same config, different
artifact: the cross-compiled binary inside each per-platform package
now reports the planned release version from `--version` (and any
other `CARGO_PKG_VERSION`-derived output) instead of the stale literal
on disk in the crate manifest.

**Verification.** Release a `kind = "npm"` `build = "bundled-cli"`
package, extract one per-platform package
(`@scope/cli-<triple>@<version>`), and run the bundled binary's
`--version`: it reports `<version>`, matching the published package.
