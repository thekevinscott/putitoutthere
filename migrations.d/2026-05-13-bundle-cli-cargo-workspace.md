# `bundle_cli` cargo workspace

**Summary.** Two collided bugs made `[package.bundle_cli]`
unsatisfiable for the standard cargo-workspace layout: a single
workspace root `Cargo.toml` with `[workspace] members = [...]` and the
`[[bin]]` declared in a member crate (the shape `cargo new --workspace`
produces, and what the polyglot Rust/Python recipe in the README
implies). With `crate_path = "."` (the default), `putitoutthere check`
parsed the workspace root `Cargo.toml` literally, saw no `[[bin]]`, and
emitted `bundle_cli.bin "X" is not declared as a [[bin]]`. With
`crate_path = "packages/rust"`, the check passed but the reusable
workflow's bundle_cli stage step couldn't find the produced binary —
cargo writes to the workspace-rooted target dir by default
(`<repo-root>/target/...`), not to the working-directory-rooted one
(`packages/rust/target/...`) the stage step assumed. There was no
`crate_path` value that satisfied both halves.

The check now walks `[workspace].members` and aggregates each member's
declared bins (honoring the implicit-binary rule, including
`[package].name = { workspace = true }` inheritance from
`[workspace.package].name`). The reusable workflow's cargo build step
pins `--target-dir target` so the produced binary is deterministically
at `${{ matrix.bundle_cli.crate_path }}/target/<triple>/release/<bin>`
regardless of whether the crate participates in a workspace. Tracked at
#337.

**Required changes.** None.

Consumers whose `[package.bundle_cli]` block already worked (single-
crate layouts, or workspaces where `crate_path` pointed directly at the
member crate and the consumer's project structure happened to make the
workspace target dir line up with the member target dir) keep building
byte-identically. Consumers whose workspace layout previously failed
the check or stage step start working without touching their config.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- `putitoutthere check` accepts the cargo-workspace shape:
  ```toml
  # /Cargo.toml
  [workspace]
  members = ["packages/rust"]

  # /packages/rust/Cargo.toml
  [package]
  name = "my-cli"
  description = "..."
  license = "MIT"

  [[bin]]
  name = "my-cli"
  path = "src/main.rs"

  # /putitoutthere.toml
  [package.bundle_cli]
  bin      = "my-cli"
  stage_to = "python/dirsql/_binary"
  # crate_path defaults to "."
  ```
  previously reported `bundle_cli.bin "my-cli" is not declared as a [[bin]]`,
  now reports zero findings.
- The reusable workflow's bundle_cli build step now passes
  `--target-dir target` to `cargo build`. The produced binary is at
  `${{ matrix.bundle_cli.crate_path }}/target/<triple>/release/<bin>`
  regardless of workspace membership, and the stage step's `src=` path
  resolves correctly by construction.
- Members declared as glob patterns (`members = ["packages/*"]`) are
  expanded against the filesystem by the check — see
  [`bundle_cli` glob workspace members](2026-05-22-bundle-cli-glob-workspace-members.md).

**Verification.** With the workspace layout above, the consumer should
see:

- `putitoutthere check` reports zero findings.
- A maturin release run produces a wheel whose `unzip -l` includes the
  staged binary (the existing wheel-content guard asserts this).
