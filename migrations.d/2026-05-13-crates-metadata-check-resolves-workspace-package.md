# Crates metadata check resolves `[workspace.package]` inheritance

**Summary.** Cargo's recommended pattern for shared crate metadata in a
workspace is `[workspace.package]` in the workspace root combined with
`<field>.workspace = true` on each member. `cargo publish` resolves the
inheritance and embeds the literal value into `Cargo.toml.orig` before
upload, so crates.io receives the resolved field. The pre-merge
`check` and the pre-publish `requireCratesMetadata` previously parsed
each member `Cargo.toml` in isolation and treated the
`{ workspace: true }` placeholder as a missing string, flagging
well-formed workspaces with `PIOT_CRATES_MISSING_METADATA` even though
the eventual `cargo publish` would succeed. The check now walks up from
each crate's `path` to find the nearest parent `Cargo.toml` carrying a
`[workspace]` table and, when a member field is declared as
`<field>.workspace = true`, resolves the value from `[workspace.package]`
before deciding it's missing. Genuinely-missing inherited fields — the
workspace root has no value for the key, or no `[workspace.package]`
block at all — still report through `PIOT_CRATES_MISSING_METADATA`. Hit
in the wild in `thekevinscott/dirsql#177`. Tracked at #328.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- Crates packages whose `Cargo.toml` reads
  ```toml
  [package]
  name = "foo"
  description.workspace = true
  license.workspace = true
  ```
  with the workspace root supplying
  ```toml
  [workspace.package]
  description = "..."
  license = "MIT"
  ```
  no longer surface as `PIOT_CRATES_MISSING_METADATA` findings from
  `putitoutthere check` or as `requireCratesMetadata` errors from the
  publish path. `license-file.workspace = true` resolves the same way.
- Crates that inherit a field whose workspace root omits it (or has no
  `[workspace.package]` block) continue to surface as
  `PIOT_CRATES_MISSING_METADATA` — the publish would still fail at
  crates.io's metadata gate, so the preflight keeps flagging it.
- Inline (non-inherited) `description` / `license` / `license-file`
  fields are unchanged.

**Verification.** Inside a workspace that centralizes metadata:

```toml
# Cargo.toml
[workspace]
members = ["packages/rust"]

[workspace.package]
license = "MIT"
description = "Shared description."

# packages/rust/Cargo.toml
[package]
name = "foo"
description.workspace = true
license.workspace = true
```

`putitoutthere check` should report `0 findings` for `foo`'s metadata,
and `cargo metadata --no-deps --format-version=1 --manifest-path packages/rust/Cargo.toml`
should show the resolved `"license":"MIT"` / `"description":"..."`.
