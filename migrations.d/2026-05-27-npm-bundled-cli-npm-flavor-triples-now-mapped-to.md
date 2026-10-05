# npm bundled-cli: npm-flavor triples now mapped to Rust triples

**Summary.** The `bundle_cli — add Rust target`, `cargo build`, and `stage binary` steps in both `_matrix.yml` and `e2e-fixture-job.yml` previously applied `${TARGET//-linux-gnu/-linux-musl}` directly to `matrix.target`. For `kind = "pypi"` rows `matrix.target` is already a Rust triple (`x86_64-unknown-linux-gnu`), so the substitution worked. For `kind = "npm"` `build = "bundled-cli"` rows `matrix.target` is an napi-rs-flavor triple (`linux-x64-gnu`, `darwin-arm64`, `win32-x64-msvc`, …); the substring `-linux-gnu` does not appear in any of these, so the substitution was a no-op and `rustup target add` received the raw npm triple and failed:

```
error: toolchain 'stable-x86_64-unknown-linux-gnu' does not support target 'linux-x64-gnu'
```

Each affected step now contains an explicit `case` statement mapping napi-rs npm triples to their Rust equivalents before the `gnu→musl` swap.

**Required changes.** None — the mapping is inside the reusable workflow. No consumer config, YAML, or scripts need to change.

**Deprecations removed.** None.

**Behavior changes without code changes.** `bundle_cli — add Rust target` now calls `rustup target add x86_64-unknown-linux-musl` (etc.) and succeeds. `cargo build --target` and the `stage binary` path-derivation use the correct Rust triple throughout.

**Verification.** A `bundle_cli` npm build job now shows `bundle_cli — add Rust target` completing without error, `bundle_cli — cargo build for linux-x64-gnu` compiling to `x86_64-unknown-linux-musl/release/<bin>`, and `bundle_cli — stage binary` logging `staged: target/x86_64-unknown-linux-musl/release/<bin> -> …`.
