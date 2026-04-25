# Changelog

All notable changes to `putitoutthere` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Every PR that changes public API adds an entry here (see
[`AGENTS.md`](./AGENTS.md#changelog-and-migration-policy)). Breaking changes
are prefixed `**BREAKING**` and link to the matching section in
[`MIGRATIONS.md`](./MIGRATIONS.md).

## Unreleased

### Added

- **`[package.bundle_cli]` recipe for maturin pypi packages** (#217). Opt-in
  declarative shape for libraries that ship a Rust CLI inside each wheel
  (the `ruff` / `uv` / `pydantic-core` pattern). Declare `bin`, `stage_to`,
  and optional `crate_path`; piot's scaffolded build job cross-compiles the
  binary per target, stages it into the package source tree, and maturin
  picks it up via `[tool.maturin].include`. Requires `build = "maturin"`
  and non-empty `targets`. See
  [Configuration → Bundled CLI](./docs/guide/configuration.md#bundled-cli)
  and [Polyglot Rust library](./docs/guide/shapes/polyglot-rust.md) for a
  worked example. No behavior change for existing packages that don't
  declare the block.

### Changed

- **Repository renamed `put-it-out-there` → `putitoutthere`.** GitHub auto-redirects the old slug, but consumers with the old URL pinned in `package.json`, `Cargo.toml`, `pyproject.toml`, or workflow files should update them. Docs site moved to <https://thekevinscott.github.io/putitoutthere/>. See [MIGRATIONS.md](./MIGRATIONS.md#repository-renamed-put-it-out-there--putitoutthere) for the consumer-facing diff.

### Deprecated

- _nothing yet_

### Removed

- _nothing yet_

### Fixed

- _nothing yet_
