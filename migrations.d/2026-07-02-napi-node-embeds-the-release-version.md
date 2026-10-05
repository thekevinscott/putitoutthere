# napi `.node` embeds the release version

**Summary.** `kind = "npm"` `build = "napi"` releases now rewrite the napi
crate's version to the planned release version before `napi build` compiles
the `.node`, mirroring the maturin (#276) and bundled-cli (#366) pre-build
bumps. Previously the compiled `.node` embedded whatever `[package].version`
literal sat on disk, so a library re-exposing the Rust core's `version()`
through napi reported a version diverging from the published npm package
(whose `package.json` version was already correct).

**Required changes.** None for the common case. The bump is a
workflow-internal step; a consumer whose napi crate's `Cargo.toml` is
colocated with `package.json` (the napi-rs single-crate default, including
the `version.workspace = true` workspace shape via #428) needs no config
change. A **multi-mode** package (`build = ["napi", "bundled-cli"]`) or one
whose napi crate lives outside the package directory has no `Cargo.toml` at
the package path — piot skips the bump there with a `::notice::` (no
per-napi `crate_path` config exists yet), so such a `.node` still embeds
its on-disk `CARGO_PKG_VERSION`. Until a `crate_path` field lands, bump that
crate's version yourself or colocate its manifest with `package.json`.

**Deprecations removed.** None.

**Behavior changes without code changes.** For a napi package, the
per-platform `.node` now reports the released version from any API sourced
on `CARGO_PKG_VERSION` (e.g. a Rust `version()` re-exported through napi).
The synthesized per-platform `package.json` version is unchanged (it was
already `matrix.version`). Non-napi npm packages are unaffected.

**Verification.** Release a napi package and read its Rust-sourced
`version()` from the installed addon (or inspect the crate manifest the
build rewrote): it matches the published npm version, not the pre-release
on-disk literal.
