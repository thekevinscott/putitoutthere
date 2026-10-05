# pypi bundle_cli binary embeds the release version

**Summary.** The reusable workflow's pypi `[package.bundle_cli]` path
already rewrote the maturin package's version source before building
wheels, but the cross-compiled CLI binary comes from the separate crate
at `bundle_cli.crate_path`. `cargo build` bakes `CARGO_PKG_VERSION`
from that crate's on-disk `Cargo.toml`, so a wheel could publish as
`0.3.6` while its bundled CLI reported an older literal such as
`0.2.7`. The build matrix now rewrites the bundle_cli crate's
`[package].version` to `matrix.version` immediately before the pypi
bundle_cli `cargo build`, matching the npm bundled-cli fix.

**Required changes.** None. Consumers who declare `kind = "pypi"`,
`build = "maturin"`, and `[package.bundle_cli]` get the corrected
behavior on their next release run against `@v0`; no
`putitoutthere.toml`, trailer, or consumer-side YAML change is needed.

**Deprecations removed.** None.

**Behavior changes without code changes.** Same config, different
artifact: the CLI binary staged into each wheel now reports the
planned release version from `--version` (and any other
`CARGO_PKG_VERSION`-derived output) instead of the stale literal in
the CLI crate manifest.

**Verification.** Release a pypi maturin package that declares
`[package.bundle_cli]`, install one of the published wheels, and run
the bundled CLI's `--version`: it reports `<version>`, matching the
published wheel metadata.
