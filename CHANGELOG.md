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
- **[Artifact contract reference page](./docs/guide/artifact-contract.md).**
  New top-level reference documenting the `artifact_name` grammar
  per `kind` × `build`, the `artifacts/<artifact-name>/` post-
  download layout, and a missing-artifact diagnosis checklist.
  Previously this material lived only in
  `docs/guide/custom-build-workflows.md` (a niche page) and was hard
  to find when the publish job's completeness check failed. No
  contract change — just makes the existing contract discoverable.
- **[Troubleshooting publish failures page](./docs/guide/troubleshooting.md).**
  New error-string-keyed index covering the `Artifact completeness
  check failed`, `spawn twine ENOENT`, OIDC HTTP 400, missing git
  identity, `.devN` sdist, and PR-event no-publish failure modes,
  each with the underlying cause and the fix.
- **[Concepts → What runs on which event](./docs/guide/concepts.md#what-runs-on-which-event)**
  table making it explicit that the publish step is gated on
  `github.event_name != 'pull_request'`, and that the signal of a
  real release is a tag push, not a green workflow-run on a PR.
- **["piot's surface is plan + publish — build is yours" callout](./docs/getting-started.md#install)**
  in Getting Started, recommending `npx putitoutthere init` in a
  scratch directory as the canonical reference when migrating from
  a different shape.

### Changed

- **Repository renamed `put-it-out-there` → `putitoutthere`.** GitHub auto-redirects the old slug, but consumers with the old URL pinned in `package.json`, `Cargo.toml`, `pyproject.toml`, or workflow files should update them. Docs site moved to <https://thekevinscott.github.io/putitoutthere/>. See [MIGRATIONS.md](./MIGRATIONS.md#repository-renamed-put-it-out-there--putitoutthere) for the consumer-facing diff.
- **Python build-step examples switched to `uv build`** across the
  documentation (`docs/guide/shapes/python-library.md`,
  `docs/guide/shapes/python-cibuildwheel.md`,
  `docs/guide/dynamic-versions.md`). `python -m build` continues to
  work — the change is example-only, not a contract change. Backends,
  artifact names, and matrix fields are unchanged. See
  [MIGRATIONS.md](./MIGRATIONS.md#python-shape-examples-now-use-uv-build) for the
  before/after, when to follow it, and when not to.

### Deprecated

- _nothing yet_

### Removed

- _nothing yet_

### Fixed

- **Scaffolded `release.yml` now forwards `GITHUB_TOKEN` to the publish
  step.** piot has cut GitHub Releases alongside tag pushes since #26, but
  Actions doesn't auto-mount the runner token as an env var, so the
  scaffolded workflow's publish step ran without `GITHUB_TOKEN` and
  silent-skipped Release creation — leaving consumers with tags but no
  Releases page entries. The publish job's `env:` block now includes
  `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. Existing `release.yml` files
  need a one-line patch — see
  [MIGRATIONS.md](./MIGRATIONS.md#scaffolded-releaseyml-now-forwards-github_token).
- **`/` in `[[package]].name` is now safe — planner encodes it for
  `actions/upload-artifact@v4`** (#230). Polyglot-monorepo grouping
  shapes (e.g. `name = "py/cachetta"`, `"js/cachetta"`) used to
  produce `artifact_name` values containing `/`, which
  `actions/upload-artifact@v4` rejects with
  `The artifact name is not valid: ... Contains the following character: Forward slash /`,
  failing the build job before piot ever ran. The planner now encodes
  each `/` to `__` in `artifact_name` (so `py/cachetta` →
  `py__cachetta-sdist`) and config validation reserves `__` in
  `pkg.name` so the round-trip stays unambiguous. Other
  upload-artifact-forbidden characters (`\`, `:`, `<`, `>`, `|`,
  `*`, `?`, `"`) are now rejected at config load. Read sites
  (`publish`, `doctor`, `preflight`, `completeness`) consume
  `artifact_name` verbatim and need no changes; consumers running
  the `cachetta#26` encode/decode workaround should remove it once
  they upgrade. See [MIGRATIONS.md](./MIGRATIONS.md#package-names-with--no-longer-need-an-encode-decode-workaround) and
  [Artifact contract → notes](./docs/guide/artifact-contract.md#naming-convention-reference).
