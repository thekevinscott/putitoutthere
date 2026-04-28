# Changelog

All notable changes to `putitoutthere` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Every PR that changes public API adds an entry here (see
[`AGENTS.md`](./AGENTS.md#changelog-and-migration-policy)). Breaking changes
are prefixed `**BREAKING**` and link to the matching section in
[`MIGRATIONS.md`](./MIGRATIONS.md).

## Unreleased

### Added

- **`workflow_call` output `has_pypi`.** The reusable workflow now emits a string `'true'`/`'false'` indicating whether the planned matrix contains any `kind = "pypi"` rows. Consumers gate their caller-side `pypi-publish` job on this so non-PyPI repos paste the canonical template verbatim without paying any runtime cost. Computed in the `plan` job from the matrix output.
- **Reusable workflow `.github/workflows/release.yml` (`workflow_call`).** The single user-facing surface. Consumer integration is one `uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0` line in their own `release.yml`; pinned action versions, plan/build/publish orchestration, and GitHub Release creation all live inside. Three optional inputs: `environment` (default `release`), `node_version` (default `24`), `python_version` (default `3.12`). No `dry_run`, `working_directory`, or `config` inputs — the plan job is already side-effect-free, the config file is `putitoutthere.toml` at the repo root, period. The engine is invoked via `uses: thekevinscott/putitoutthere@v0` so the workflow file and the engine always agree on a single git ref.

- **`[package.bundle_cli]` recipe for maturin pypi packages** (#217). Opt-in declarative shape for libraries that ship a Rust CLI inside each wheel (the `ruff` / `uv` / `pydantic-core` pattern). Declare `bin`, `stage_to`, and optional `crate_path`; the reusable workflow cross-compiles the binary per target, stages it into the package source tree, and maturin picks it up via `[tool.maturin].include`. Requires `build = "maturin"` and non-empty `targets`. See [README → Recipes → Rust CLI inside a PyPI wheel](./README.md#rust-cli-inside-a-pypi-wheel). No behavior change for existing packages that don't declare the block.

### Changed

- **BREAKING: PyPI uploads moved to a caller-side `pypi-publish` job.** PyPI's Trusted Publisher matching filters candidates by `repository_owner` + `repository_name` *before* checking `job_workflow_ref` ([Warehouse implementation](https://github.com/pypi/warehouse/blob/main/warehouse/oidc/models/github.py)); since the OIDC `repository` claim always reflects the caller's repo even inside a reusable workflow, a TP registered against `thekevinscott/putitoutthere` is filtered out before the workflow_ref is ever checked. PyPI explicitly documents this as unsupported ([troubleshooting](https://docs.pypi.org/trusted-publishers/troubleshooting/)). Tracked at [pypi/warehouse#11096](https://github.com/pypi/warehouse/issues/11096), no timeline. The engine still does plan + build + version-rewrite + git tag for PyPI; the actual upload (`pypa/gh-action-pypi-publish`) now runs in the consumer's workflow file as a second job, gated on `needs.release.outputs.has_pypi`. The canonical template grew from ~12 → ~30 lines but remains a single copy-paste — the `if:` skips the job for non-PyPI repos. See [MIGRATIONS.md](./MIGRATIONS.md#pypi-uploads-moved-to-caller-side-job) and [`notes/audits/2026-04-28-pypi-tp-reusable-workflow-constraint.md`](./notes/audits/2026-04-28-pypi-tp-reusable-workflow-constraint.md).
- **Public consumer surface collapsed to the README + the reusable workflow.** The CLI, the JS action (`action.yml`), and the diagnostic subcommands (`doctor`, `preflight`) are internal seams the reusable workflow invokes; consumers do not call them. The entire `docs/` directory is removed — `README.md` is the single user-facing surface. See [MIGRATIONS.md](./MIGRATIONS.md#public-surface-collapsed-to-a-reusable-workflow) for the before/after.
- **Auth is OIDC trusted publishers only.** The reusable workflow does not pass long-lived registry tokens (`NPM_TOKEN`, `PYPI_API_TOKEN`, `CARGO_REGISTRY_TOKEN`) as secrets. The engine's env-var fallback code paths still exist (in `src/auth.ts`); they're just not reachable through the reusable workflow.
- **Repository renamed `put-it-out-there` → `putitoutthere`.** GitHub auto-redirects the old slug, but consumers with the old URL pinned in `package.json`, `Cargo.toml`, `pyproject.toml`, or workflow files should update them. See [MIGRATIONS.md](./MIGRATIONS.md#repository-renamed-put-it-out-there--putitoutthere).
- **BREAKING: `[[package]].paths` renamed to `[[package]].globs`.** The `path`/`paths` pair was confusing — singular and plural differed only in a trailing `s` while meaning two unrelated things (the package working directory vs. the cascade-trigger globs). Configs declaring `paths` now fail validation. See [MIGRATIONS.md](./MIGRATIONS.md#package-paths-renamed-to-globs).

### Deprecated

- _nothing yet_

### Removed

- **The entire `docs/` directory** (VitePress site, all guide pages, all shape walkthroughs). README is the single user-facing surface. Engine contracts that were documented in `docs/guide/{artifact-contract,runner-prerequisites}.md` moved to `notes/internals/` — internal references the reusable workflow honors so consumers don't have to know them.
- **`.github/workflows/docs.yml` and `docs-test.yml`** — the docs site no longer exists.
- **`build_workflow:` config field.** Removed from the schema in `src/config.ts`; configs declaring it now fail validation.
- **`putitoutthere init` subcommand** and the templates it scaffolded. Source removed (`src/init.ts`, `src/templates.ts`, plus tests, plus `--force` and `--cadence` flag plumbing).
- **`migrations/` directory** moved to `notes/migrations-pre-rewrite/`. Stale plans drafted against the prior hand-written-`release.yml` model.
- **`[package.trust_policy]` config block + the OIDC trust-policy diff machinery.** Removed: `src/oidc-policy.ts`, `src/registries/crates-trust.ts`, the `trust_policy` schema field, and the matching README section. The check was opt-in defensive validation — for npm + PyPI it could only verify "the workflow file you declared exists locally" (no public read API for trust-policy config), making it a typo-catcher rather than a real drift detector. crates.io's registry cross-check was the only path with real bug-catching power and required a separate `CRATES_IO_DOCTOR_TOKEN`. Net: false security; renaming `release.yml` still produces an HTTP 400 from the registry, which is the same UX as before and what every other tool gives you.
- **`putitoutthere doctor` subcommand + `src/doctor.ts`.** Its main job was the trust-policy validation phases above. With those gone, doctor was checking workflow structural details that are already validated by the reusable workflow's own shape. Internal seam, no consumer use case.
- **`putitoutthere preflight` subcommand + `src/preflight-run.ts`.** Standalone diagnostic CLI surface. The internal `requireAuth` check that gates `publish` is preserved (`src/preflight.ts` stays).
- **`putitoutthere token` subcommand + `src/token.ts`, `src/token-scope.ts`.** The `token list` / `token inspect` operator-debugging surface was built when long-lived registry tokens were the norm. Under OIDC-only there's nothing to enumerate or scope-check at the env level. ~1,100 lines removed.
- **`putitoutthere auth login/logout/status` subcommand + `src/auth.ts`, `src/keyring.ts`.** The GitHub App device-flow login existed solely to power `token list --secrets` (which fetched secret names via the GitHub API). With `token` removed, the App + keyring + device-flow plumbing is dead weight. ~500 lines removed. The `putitoutthere-cli` GitHub App registration is no longer used.
- **`src/release.ts` (engine-side GitHub Release creation).** Duplicated by the reusable workflow's `gh release create --generate-notes` step. The engine cuts the tag and stops; the workflow owns the Release. ~129 lines removed.
- **Dead config fields**: `cadence`, `agents_path`, `smoke`, `wheels_artifact`. Defined in the schema; never read anywhere in the engine.
- **`--preflight-check` flag on `publish`.** The deep token-scope check it gated was the sole consumer of `src/token-scope.ts`. Same reason as the `token` subcommand removal: under OIDC-only there's no long-lived token to scope-check.

### Fixed

- **PyPI artifact discovery now matches the documented `{name}-sdist` and `{name}-wheel-{target}` shapes exactly.** (#244)
  Previously the handler used a bare prefix match (`entry.startsWith("{name}-")`), which silently picked up sibling packages whose names extended the same prefix (e.g. `foo`'s discovery matched `foo-extras-sdist`). The handler now matches the sdist directory exactly and the wheel directories by `{name}-wheel-` prefix only. Affects multi-package repos where one pypi package's name is a prefix of another's.

- **Reusable workflow's maturin sdist row now uses `command: sdist`.** (#244)
  `maturin build --sdist` builds a wheel AND an sdist; the sdist row's
  artifact tarball ended up containing a manylinux wheel that collided
  with the per-target wheel rows at upload time, causing twine to abort
  with `400 File already exists`. Splitting the sdist invocation to use
  `command: sdist` (sdist-only) eliminates the collision.

- **Synthesized npm platform packages now inherit `repository`, `license`, and `homepage` from the main `package.json`.** (#244)
  npm's provenance verifier rejected platform tarballs with `E422 Error verifying sigstore provenance bundle: Failed to validate repository information: package.json: "repository.url" is "", expected to match "https://github.com/<owner>/<repo>"`. The synthesizer used to write only `name`/`version`/`os`/`cpu`/`files`/`main`/`libc`; the empty repository URL didn't match the publishing repo baked into the sigstore bundle. Identity fields are now copied from the main package so per-target tarballs validate. Affects `build = "napi"` and `build = "bundled-cli"` packages.

- **Reusable workflow's npm build step now forces `shell: bash`.** (#244)
  The build matrix can target Windows runners, where GitHub Actions defaults
  to `pwsh` for `run:` blocks. The npm build's `if [ -f package-lock.json ]`
  branch is bash syntax, which PowerShell parsed as a malformed expression
  and aborted with `ParserError`. Adding `shell: bash` makes the step
  portable across Linux, macOS, and Windows runners. No config changes
  required for consumers; pure JS-on-ubuntu setups were unaffected.

- **Reusable workflow now exchanges OIDC ID-token for a `CARGO_REGISTRY_TOKEN`
  before invoking the engine.** (#244) `cargo publish` was failing with
  `error: no token found, please run cargo login` because the publish
  job's env had no `CARGO_REGISTRY_TOKEN`. PyPI uploads (twine) and npm
  publish both consume the OIDC ID-token directly via registry-side
  acceptance; cargo doesn't — it needs a registry-issued bearer token,
  which `rust-lang/crates-io-auth-action@v1` produces from the OIDC
  ID-token. The workflow now runs that action conditionally (only when
  the plan contains a `kind = "crates"` row) and exports the resulting
  token to `$GITHUB_ENV` for the engine subprocess. No config or
  workflow changes required for consumers.

- **Crates publish's pre-cargo dirty-tree check now ignores the
  reusable workflow's `artifacts/` scratch directory.** (#244)
  The pre-publish guard scans `git status --porcelain` for stray edits
  outside the managed `Cargo.toml` (the engine passes `--allow-dirty`
  to cargo to permit the writeVersion bump, then re-imposes a narrower
  check). Reusable workflow's `actions/download-artifact@v4` step
  always creates `artifacts/` under cwd, even for crates-only
  fixtures with nothing to download — the pre-check was rejecting
  with `unexpected dirty files in the working tree outside ... -
  artifacts/`. The scan now treats `${ctx.artifactsRoot}` (the dir
  the engine itself populates) as engine-managed and skips it. No
  config or workflow changes required.

- **Crates publish no longer fails the completeness check.** (#244)
  `cargo publish` packages and uploads from source on the registry
  side, so the reusable workflow never produces a `<name>-crate/`
  artifact directory. The pre-publish completeness check was demanding
  a `.crate` file that nothing in the pipeline ever creates, which made
  any consumer with a `kind = "crates"` package fail with
  `missing artifact directory <name>-crate/` before cargo was ever
  invoked. Crates rows now skip the completeness check (same reasoning
  as vanilla npm rows). No config or workflow changes required.
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
  [Artifact contract → notes](./notes/internals/artifact-contract.md#naming-convention-reference).
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
