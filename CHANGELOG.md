# Changelog

All notable changes to `putitoutthere` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Every PR that changes public API adds an entry here (see
[`AGENTS.md`](./AGENTS.md#changelog-and-migration-policy)). Breaking changes
are prefixed `**BREAKING**` and link to the matching section in
[`MIGRATIONS.md`](./MIGRATIONS.md).

## Unreleased

### Added

- **Reusable workflow `.github/workflows/release.yml` (`workflow_call`).** The single user-facing surface. Consumer integration is one `uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v1` line in their own `release.yml`; pinned action versions, plan/build/publish orchestration, and GitHub Release creation all live inside. Three optional inputs: `environment` (default `release`), `node_version` (default `24`), `python_version` (default `3.12`). No `dry_run`, `working_directory`, or `config` inputs — the plan job is already side-effect-free, the config file is `putitoutthere.toml` at the repo root, period. The engine is invoked via `uses: thekevinscott/putitoutthere@v1` so the workflow file and the engine always agree on a single git ref.

- **`[package.bundle_cli]` recipe for maturin pypi packages** (#217). Opt-in declarative shape for libraries that ship a Rust CLI inside each wheel (the `ruff` / `uv` / `pydantic-core` pattern). Declare `bin`, `stage_to`, and optional `crate_path`; the reusable workflow cross-compiles the binary per target, stages it into the package source tree, and maturin picks it up via `[tool.maturin].include`. Requires `build = "maturin"` and non-empty `targets`. See [README → Recipes → Rust CLI inside a PyPI wheel](./README.md#rust-cli-inside-a-pypi-wheel). No behavior change for existing packages that don't declare the block.

### Changed

- **Public consumer surface collapsed to the README + the reusable workflow.** The CLI, the JS action (`action.yml`), and the diagnostic subcommands (`doctor`, `preflight`) are internal seams the reusable workflow invokes; consumers do not call them. The entire `docs/` directory is removed — `README.md` is the single user-facing surface. See [MIGRATIONS.md](./MIGRATIONS.md#public-surface-collapsed-to-a-reusable-workflow) for the before/after.
- **Auth is OIDC trusted publishers only.** The reusable workflow does not pass long-lived registry tokens (`NPM_TOKEN`, `PYPI_API_TOKEN`, `CARGO_REGISTRY_TOKEN`) as secrets. The engine's env-var fallback code paths still exist (in `src/auth.ts`); they're just not reachable through the reusable workflow.
- **Repository renamed `put-it-out-there` → `putitoutthere`.** GitHub auto-redirects the old slug, but consumers with the old URL pinned in `package.json`, `Cargo.toml`, `pyproject.toml`, or workflow files should update them. See [MIGRATIONS.md](./MIGRATIONS.md#repository-renamed-put-it-out-there--putitoutthere).

### Deprecated

- _nothing yet_

### Removed

- **The entire `docs/` directory** (VitePress site, all guide pages, all shape walkthroughs). README is the single user-facing surface. Engine contracts that were documented in `docs/guide/{artifact-contract,runner-prerequisites}.md` moved to `notes/internals/` — internal references the reusable workflow honors so consumers don't have to know them.
- **`.github/workflows/docs.yml` and `docs-test.yml`** — the docs site no longer exists.
- **`build_workflow:` config field.** Removed from the schema in `src/config.ts`; configs declaring it now fail validation.
- **`putitoutthere init` subcommand** and the templates it scaffolded. Source removed (`src/init.ts`, `src/templates.ts`, plus tests, plus `--force` and `--cadence` flag plumbing).
- **`migrations/` directory** moved to `notes/migrations-pre-rewrite/`. Stale plans drafted against the prior hand-written-`release.yml` model.

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
- **Documentation accuracy pass** (#231). A docs-vs-code audit caught
  several places where reference material lagged behind shipped behavior.
  No code paths changed beyond a stale help-text line; existing configs
  and workflows are unaffected.
  - `putitoutthere --help` text for `--json` no longer claims "(plan
    only)" — the flag has worked across every command that emits a
    result since their respective additions. `docs/api/cli.md` now lists
    the supported commands explicitly.
  - `docs/api/cli.md` documents short flags (`-h`, `-v`, `--version`)
    and exit codes (`0` / `1` / `4`).
  - `docs/api/action.md` documents the `outputs.matrix` contract
    (output key omitted when empty, not "empty string"), the matrix-row
    field schema, and the GitHub Release body shape.
  - `action.yml`'s `command` description and `docs/api/action.md`
    clarify that the action shells through to any putitoutthere CLI
    subcommand, not just `plan` / `publish` / `doctor`.
  - `docs/guide/configuration.md` adds the previously-shape-only `pypi`
    field to the central `kind = "pypi"` table.
  - `docs/guide/trailer.md` documents the package-name character
    grammar, leading-whitespace tolerance, and last-wins semantics.
  - `README.md`'s scaffolding description now correctly mentions both
    workflow files written by `putitoutthere init`.
- **Publish path works end-to-end for slash-containing `pkg.name`** (#237).
  Two follow-up bugs that #230 didn't catch: (1) `pypi.ts.collectArtifacts`
  and `npm-platform.ts.synthesizePlatformPackage` both built directory
  lookups from raw `pkg.name`, so a package called `py/foo` couldn't
  match the encoded on-disk directory `py__foo-sdist/` and the publish
  step reported `pypi: no artifacts found for py/foo under <root>`.
  (2) The planner emitted glob `artifact_path` values
  (`${pkg.path}/dist/*.tar.gz`, `${pkg.path}/dist/*.whl`,
  `${pkg.path}/target/package/*.crate`), which `actions/upload-artifact@v4`
  treats differently from a directory `path:` — it preserves the
  workspace-relative path, so the file lands at
  `<name>/packages/python/dist/foo.tar.gz` instead of `<name>/foo.tar.gz`.
  Both bugs fixed: handlers now encode `pkg.name` via
  `sanitizeArtifactName` and walk the artifact directory recursively
  for the expected file extensions; planner emits directory-shaped
  `artifact_path` values for the three slots that previously used a
  glob. Consumers using `${{ matrix.artifact_path }}` verbatim see no
  required workflow changes; consumers who hand-coded a glob path
  should switch to the directory shape — see
  [MIGRATIONS.md](./MIGRATIONS.md#publish-path-works-end-to-end-for-slash-containing-pkgname).
