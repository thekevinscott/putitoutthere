# Version bump follows Cargo workspace inheritance

**Summary.** piot's pre-build version rewrite — the maturin `write-version`
step (#276) and the npm / pypi bundled-cli `write-crate-version` step
(#366) — now understands Cargo **workspace version inheritance**. A crate
whose `[package]` declares `version.workspace = true` and inherits its
version from `[workspace.package].version` at the workspace root (the
standard shape for a single Rust core re-exposed as a PyO3 wheel and a napi
addon) previously failed these steps with `Cargo.toml: no [package].version
field found`. The rewrite now resolves the inheritance: a literal
`[package].version` is bumped in place, while an inheriting member's version
is bumped at the workspace root's `[workspace.package].version`.

**Required changes.** None. Additive — a repo layout that previously errored
at release now works. If you kept a duplicated literal `[package].version`
in each crate to work around this, you may switch the members to
`version.workspace = true` and let piot bump the workspace root.

**Deprecations removed.** None.

**Behavior changes without code changes.** A `kind = "pypi"`
`build = "maturin"` or `kind = "npm"` `build = "bundled-cli"` package whose
crate inherits its version from the workspace no longer fails the build
step; the produced wheel / cross-compiled binary now carries the planned
release version. Single-crate layouts with a literal `[package].version` are
byte-for-byte unchanged.

**Verification.** In a cargo workspace whose root declares
`[workspace.package]` `version = "X"` and whose maturin/napi crate sets
`version.workspace = true`, run a release: the published wheel / `.node`
carries the planned release version (not the stale on-disk `X`), and the
workspace-root `Cargo.toml` is the manifest rewritten during the build.
