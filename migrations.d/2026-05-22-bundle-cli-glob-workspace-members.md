# `bundle_cli` glob workspace members

**Summary.** The `bundle_cli` cargo-workspace fix above taught
`putitoutthere check` (and the pre-publish preflight) to walk
`[workspace].members` and aggregate each member crate's declared
`[[bin]]` entries, so `crate_path = "."` resolves a `[[bin]]` that
lives in a member crate. That walk only handled *literal* member
entries. cargo `members` entries are globs, and `members =
["packages/*"]` — a Rust core crate under `packages/rust` wrapped by
sibling Python / npm packages — is the standard polyglot-repo shape. A
glob entry never resolved to a literal `<member>/Cargo.toml`, so the
member crate's `[[bin]]` went unseen and `crate_path = "."` was
rejected with `bundle_cli.bin "X" is not declared as a [[bin]]`.

The check now expands `[workspace].members` glob entries against the
filesystem the way cargo resolves them; a member crate behind a glob is
found like any literal member.

**Required changes.** None.

Consumers whose workspace declares `members` with literal paths are
unaffected. Consumers who declared `members` with a glob and worked
around the rejected check — by also listing the member crate as a
literal entry, or by pointing `crate_path` straight at the member
crate — can drop the workaround and let `crate_path` default to `"."`.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- `putitoutthere check` accepts a glob-member workspace:
  ```toml
  # /Cargo.toml
  [workspace]
  members = ["packages/*"]

  # /packages/rust/Cargo.toml
  [package]
  name = "rust-core"

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

**Verification.** With the glob-member workspace above, `putitoutthere
check` reports zero findings.
