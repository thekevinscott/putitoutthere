# `[package.bundle_cli]` features and `no_default_features`

**Summary.** `[package.bundle_cli]` previously only worked for crates
whose CLI binary built with a vanilla `cargo build --release --target
<triple> --bin <bin>` — no feature flags, no env. The standard shape
for libraries that ship an optional CLI (ruff, uv, pydantic-core,
biome, swc, dirsql) is `[[bin]] required-features = ["cli"]`, so the
binary's deps don't pollute `cargo add <name>`. Without a way to pass
`--features`, `cargo build --bin <bin>` exits with `target ... requires
the features: cli` and the recipe was inert for the consumers it was
designed for. The schema now exposes:

- `features: list[string]` — forwarded to `cargo build --features
  <comma-list>` when non-empty. Defaults to `[]`.
- `no_default_features: bool` — adds `--no-default-features` when
  true. Defaults to `false`.

Both keys are optional; the schema defaults preserve byte-identical
cargo invocations for existing `[package.bundle_cli]` blocks. Empty
strings inside the `features` list are rejected at config load. The
caveat under [`bundle_cli` now actually stages the binary](2026-05-09-package-bundle-cli-now-actually-stages-the-binary.md)
that named this gap as "not currently supported" has been corrected.
Tracked in #300.

**Required changes.** None for consumers whose binary builds without
feature flags. Consumers whose `Cargo.toml` declares `required-features
= ["cli"]` (or who otherwise need a non-default feature set on the CLI
binary) add the new keys:

```diff
 [package.bundle_cli]
 bin        = "my-cli"
 stage_to   = "src/my_py/_binary"
 crate_path = "crates/my-rust"
+features            = ["cli"]
+no_default_features = false
```

**Deprecations removed.** None.

**Behavior changes without code changes.** None. The new keys default
to the equivalent of "no extra cargo flags," matching pre-#300
behavior.

**Verification.** Trigger a release on a maturin pypi package whose
crate uses `[[bin]] required-features = ["cli"]` and that now declares
`features = ["cli"]` in its `[package.bundle_cli]` block. The
`bundle_cli — cargo build for <triple> (<bin>)` step in the build job's
log emits `cargo build --release --target <triple> --bin <bin>
--features cli` and exits zero; the wheel-content guard step that
follows confirms `<stage_to>/<bin>` is present in the produced `.whl`.

---
