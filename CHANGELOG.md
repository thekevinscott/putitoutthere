# Changelog

All notable changes to `putitoutthere` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Every PR that changes public API adds an entry here (see
[`AGENTS.md`](./AGENTS.md#changelog-and-migration-policy)). Breaking changes
are prefixed `**BREAKING**` and link to the matching section in
[`MIGRATIONS.md`](./MIGRATIONS.md).

## Unreleased

### Added

- **`[package.bundle_cli]` accepts `features` and `no_default_features` for crates that gate the CLI behind a Cargo feature.** The lib-with-optional-CLI pattern — `[[bin]] required-features = ["cli"]` so `cargo add <name>` doesn't drag the CLI's deps onto library consumers — is the standard shape for crates that fit `bundle_cli`'s use case (ruff, uv, pydantic-core, biome, swc, dirsql). v0.2.0's wiring shipped `cargo build --release --target $TARGET --bin $BIN` with no `--features` path, which made the recipe inert for exactly the consumers it targets. The reusable workflow's cargo build step now appends `--features <comma-list>` when the schema's new `features: list[string]` is non-empty and `--no-default-features` when the new `no_default_features: bool` is true. Defaults are `[]` and `false`, so existing `[package.bundle_cli]` blocks keep building byte-identically. Empty-string entries inside `features` are rejected at config load. The "crates that gate the CLI behind a Cargo feature are not currently supported" caveat in the v0.2.0 MIGRATIONS note has been corrected. See [README → Recipes → Rust CLI inside a PyPI wheel](./README.md#rust-cli-inside-a-pypi-wheel) and [MIGRATIONS.md](./MIGRATIONS.md#bundle_cli-features-and-no_default_features). #300.
- **Reusable workflow accepts a caller-provided `NPM_TOKEN` via `secrets:`.** OIDC trusted publishers remain the default and recommended path, but Trusted Publishing on npm binds to an *already-published* package — so the first publish of a brand-new npm package has no OIDC path available, and consumers were forced into a manual 6+ package `0.0.0-bootstrap` stub bootstrap (documented nowhere, only discoverable by reading commit history of dirsql or by hitting the failure). The `workflow_call` surface now declares an optional `NPM_TOKEN` secret; when set AND the planned matrix contains an npm row, the secret is exported to `$GITHUB_ENV` as `NODE_AUTH_TOKEN` and the npm CLI prefers the long-lived token over the OIDC path. Callers without a token keep the OIDC path unchanged. For bundled-cli / napi families the same secret authenticates publishes of all per-platform sub-packages on first publish; once those exist, each one needs its own Trusted Publisher registration (the bypass is a one-time bootstrap, not a permanent path). Mirrors the #283 crates fallback in shape. Hit in the wild on the maintainer's own dirsql project (first version of `@dirsql/cli-linux-x64-gnu` on npm is `0.0.0-bootstrap`, 2026-04-30; real `0.2.8` lands the next day) and on `darkfactory`'s first publish. See [README → Trusted publishers → npm](./README.md#npm) and [MIGRATIONS.md](./MIGRATIONS.md#npm-token-fallback). #302.
- **Reusable workflow accepts a caller-provided `CARGO_REGISTRY_TOKEN` via `secrets:`.** OIDC trusted publishers remain the default and recommended path, but Trusted Publishing on crates.io binds to an *already-published* crate — so the first publish of a brand-new crate has no OIDC path available, and consumers were forced to either fork the workflow or run `cargo publish` outside it. The `workflow_call` surface now declares an optional `CARGO_REGISTRY_TOKEN` secret; when set, the `rust-lang/crates-io-auth-action` OIDC exchange is skipped and the caller-provided token is exported to `$GITHUB_ENV` for the engine's crates handler to read. Callers without a token keep the OIDC path unchanged. The "Auth: OIDC trusted publishers ... Long-lived registry tokens are explicitly NOT supported" framing in `release.yml`'s header has been softened to match. See [README → Trusted publishers → crates.io](./README.md#cratesio) and [MIGRATIONS.md](./MIGRATIONS.md#crates-token-fallback). #283.
- **Preflight check: every cascaded `kind = "crates"` package's `Cargo.toml` must declare `[package].description` and either `[package].license` or `[package].license-file`.** crates.io rejects publish with `400 Bad Request: missing or empty metadata fields: ...` after `cargo publish`'s verification build has compiled the crate and every transitive dep — wasting the entire publish job on a precondition checkable in milliseconds. The new `requireCratesMetadata` runs alongside `requireAuth` / `requireProvenanceMetadata` in `src/publish.ts`, before any side effects, and reports every failing package + every missing field in one error rather than failing on the first. Surfaces a new stable error code, `PIOT_CRATES_MISSING_METADATA`. Whitespace-only field values are treated as empty. Hit in the wild on `thekevinscott/darkfactory`'s first crate publish; same shape as #280 (npm `repository`). See [MIGRATIONS.md](./MIGRATIONS.md#crates-cargo-toml-must-declare-description-and-license). #290.
- **Preflight check: every cascaded `kind = "npm"` package must declare a non-empty `repository` field in `package.json`.** `putitoutthere` invokes `npm publish --provenance` on the OIDC trusted-publisher path, and the npm CLI hard-requires this field so the registry can verify the artifact was built from the repo the trusted publisher declares. A missing or empty field previously surfaced as a confusing tail-end npm error after the runner had spun up, OIDC had been negotiated, and the artifact had been built — wasting a full release run on a precondition checkable in milliseconds. The new `requireProvenanceMetadata` runs alongside `requireAuth` in `src/publish.ts`, before any side effects, and reports every failing package in one error rather than failing on the first. Surfaces a new stable error code, `PIOT_NPM_MISSING_REPOSITORY`. Both the canonical object form (`{ type, url, directory? }`) and the legacy single-string form are accepted; only an empty `url` (or no `url` at all) fails. The npm handler's inline backstop is also tightened to match the same predicate (previously `!pkg.repository` slipped `{}`, `{ type: 'git' }`, and whitespace strings through). Documented in [README → `kind = "npm"`](./README.md#kind--npm). See [MIGRATIONS.md](./MIGRATIONS.md#npm-package-json-must-declare-repository). #280.
- **Reusable workflow `.github/workflows/build.yml` (`workflow_call`).** PR-time build verification: runs the same plan + build matrix that `release.yml` runs, calling a shared internal `_matrix.yml` reusable workflow so action pins, per-target build steps, and runner selection cannot drift between the two paths. `build.yml` declares only `permissions: contents: read` and contains no publish job, no `id-token: write`, no OIDC trusted-publisher exchange, and no registry auth — the bytes required to publish do not exist on this code path. Two optional inputs forwarded to `_matrix.yml`: `node_version` (default `24`), `python_version` (default `3.12`). Concurrency is keyed on `github.ref` with `cancel-in-progress: true` so PR pushes supersede stale runs (release.yml's repository-keyed group with `cancel-in-progress: false` is unchanged). An `actionlint`-job grep assertion rejects any future patch that adds `id-token: write` to `build.yml` or `_matrix.yml`. See [README → Build check](./README.md#1b-optional-drop-in-githubworkflowsbuild-checkyml) and [MIGRATIONS.md](./MIGRATIONS.md#new-buildyml-reusable-workflow-for-pr-time-build-verification).
- **`PIOT_PUBLISH_EMPTY_PLAN` error code.** Surfaced when `publish` is invoked with an empty matrix. Joins `PIOT_AUTH_NO_TOKEN` in the stable error-code vocabulary; foreign agents debugging a failed publish can fingerprint on the code without parsing prose.
- **`kind = "npm"` `build` accepts an array of entries with consumer-defined platform-package name templates.** For packages that ship both a napi-rs Node addon and a CLI binary from the same npm package (the `@swc/core` shape), declare `build = [{ mode = "napi", name = "@scope/lib-{triple}" }, { mode = "bundled-cli", name = "@scope/cli-{triple}" }]`. Each entry contributes its own per-platform package family; the main package's `optionalDependencies` spans both. Entries can be bare mode strings (`"napi"`, defaults to `{name}-{triple}` template) or `{ mode, name }` objects. Variables surfaced in `name` templates: `{name}`, `{scope}`, `{base}`, `{triple}`, `{mode}`. `{version}` is intentionally not surfaced. Single-mode string form (`build = "napi"`) preserved byte-for-byte — same artifact-name layout, same platform-package names, no migration pressure on existing consumers. See [README → Recipes → Multi-mode npm family](./README.md#multi-mode-npm-family) and [MIGRATIONS.md](./MIGRATIONS.md#npm-build-accepts-array-of-entries).

### Changed

- **BREAKING: `publish` throws on an empty matrix instead of exiting clean.** The reusable workflow's `publish` step now fails red when the plan is empty, with `PIOT_PUBLISH_EMPTY_PLAN` in the message. Previously, an empty plan logged `info: publish: plan is empty; nothing to release` and returned `ok: true` — leaving consumers with green release runs that hadn't published anything. Skips belong at the workflow gate (the `if:` on the publish job that reads the plan job's matrix output), not in the publish step. See [MIGRATIONS.md](./MIGRATIONS.md#publish-throws-on-empty-matrix).

### Deprecated

- _nothing yet_

### Removed

- _nothing yet_

### Fixed

- **Single-artifact publish jobs no longer fail completeness with `missing artifact directory <name>/`.** `actions/download-artifact@v8` is count-sensitive: with `path: artifacts` and no `name`/`pattern` filter, multiple artifacts each get their own `artifacts/<name>/` subdir (the documented multi-case the engine relies on), but a single artifact extracts directly into `artifacts/` with no per-artifact subdir. Consumers whose plan emits exactly one expected artifact — canonical case: pure-Python `[[package]]` with `build = "hatch"`, which emits an sdist row only — therefore aborted at the engine's completeness check before any side effect ran. The reusable workflow's publish job now normalizes the layout in-process before completeness: when the plan expects a single staged artifact and the documented subdir is absent, files in `artifacts/` are moved into `artifacts/<artifact_name>/` so the rest of the engine sees the contract it was written against. No-op in the multi-artifact case, when the subdir already exists, or when nothing was downloaded (crates-only / vanilla-npm plans). No consumer-side change required. Hit in the wild on a pypi-only consumer with a single sdist row; multi-artifact consumers (pypi + npm, or sdist + wheels) were unaffected. See [MIGRATIONS.md](./MIGRATIONS.md#single-artifact-publish-layout-normalization). #311.

- **Bundled-CLI / napi npm consumers' `npm run build` step now sees `TARGET` and `BUILD` env vars on every matrix row.** The reusable workflow's `_matrix.yml` and `release.yml` previously ran the npm build step with no env block, so consumers' build scripts that read `process.env.TARGET` to know which triple to cross-compile saw `undefined` and either crashed or silently no-oped. Every per-platform matrix row then uploaded an empty `build/<triple>/` directory and `actions/upload-artifact@v7` flagged `No files were found with the provided path: ...`. The internal `e2e-fixture-job.yml` already passed `TARGET` / `BUILD` correctly — meaning the fixture suite passed but a real consumer's first publish still failed; an integration-tier divergence rather than a behavior bug per se. Both the build matrix step and the publish-job rebuild step in `release.yml` now set the env block. `_matrix.yml` exposes `TARGET=${{ matrix.target }}` / `BUILD=${{ matrix.build }}` per row; `release.yml`'s rebuild loop sets `TARGET=main BUILD=` per iteration (the publish-time rebuild only fires for the main package's row, since per-platform sub-packages stage from `artifacts/` via the engine's npm-platform handler). The README's [Bundled-CLI npm family](./README.md#bundled-cli-npm-family) recipe gained the consumer-side build-script contract that was previously missing — TARGET/BUILD vocabulary and a minimal `scripts/build.cjs` covering the simple single-workspace case. Hit in the wild on `thekevinscott/darkfactory`'s first release; tracked at #287. See [MIGRATIONS.md](./MIGRATIONS.md#npm-build-step-target-build-env-vars).

- **First-publish bundled-cli / napi npm builds no longer fail on lockfile drift.** Consumers of the bundled-cli / napi shape declare `optionalDependencies` for `<name>-<triple>@<version>` platform packages that this pipeline publishes. On the very first publish those entries 404 on the registry; pnpm 10 silently drops 404'd optionals from the lockfile when it is regenerated locally; a subsequent CI run with `pnpm install --frozen-lockfile` (or `npm ci`) refuses because lockfile and `package.json` disagree. Both install steps in the reusable workflow — `_matrix.yml`'s build-matrix install and `release.yml`'s publish-job rebuild step (added in #256) — now self-heal: a failed strict install falls back to its non-strict form (`pnpm install --no-frozen-lockfile` / `npm install`) with a `::warning::` line in the run log naming the recovery. No consumer-side change required; lockfiles can stay committed and `optionalDependencies` can stay declared. Hit in the wild on `thekevinscott/darkfactory`'s first release (#integration-2026-05-bundled-cli). The README's [Bundled-CLI npm family](./README.md#bundled-cli-npm-family) recipe grew a `[!NOTE]` callout documenting the chicken-and-egg and the workflow's transparent recovery. See [MIGRATIONS.md](./MIGRATIONS.md#first-publish-bundled-cli-lockfile-self-heal).

- **pypi/maturin `[package.bundle_cli]` now actually ships the bundled binary inside published wheels.** The recipe was advertised as shipped in v0.2.0 (#217) — config parsing accepted `[package.bundle_cli]`, the planner attached it to per-target wheel rows, and `MIGRATIONS.md` named the two scaffolded build steps consumers should expect. None of those steps existed in `.github/workflows/_matrix.yml`. Consumers who declared the block (us, in `thekevinscott/dirsql`) shipped wheels missing the binary; `pip install <pkg> && <pkg> ...` failed at runtime with `FileNotFoundError`. The reusable workflow's build job now, for every per-target wheel row that carries `matrix.bundle_cli`: (1) `rustup target add ${{ matrix.target }}`, (2) `cargo build --release --target ${{ matrix.target }} --bin ${{ matrix.bundle_cli.bin }}` against `crate_path`, (3) copies the resulting binary into `${{ matrix.path }}/${{ matrix.bundle_cli.stage_to }}/` so maturin's `[tool.maturin].include` glob picks it up as wheel data, and (4) runs a permanent post-build wheel-content guard that opens the produced `.whl` and refuses to upload-artifact if `<stage_to>/<bin>` is missing. The guard is independent of staging — it catches any future regression where the cross-compile silently routes the binary to the wrong path. Consumers do not need to change their existing `[package.bundle_cli]` config or their `[tool.maturin].include` glob; the recipe just starts working. The cross-compile assumes the binary is buildable with a vanilla `cargo build --release --bin <bin>` (no `--features`, no env, no special flags); crates that gate the CLI behind a Cargo feature are not yet supported. The `.exe` suffix on Windows is handled. See [README → Recipes → Rust CLI inside a PyPI wheel](./README.md#rust-cli-inside-a-pypi-wheel) and [MIGRATIONS.md](./MIGRATIONS.md#bundle_cli-now-actually-stages-the-binary). #282.

- **`putitoutthere.toml` validation now names common typos in the failure message.** A consumer integration shipped a config with `version` at the file root, `[[packages]]` (plural), `registry =` instead of `kind =`, and `files =` instead of `globs =`. The raw zod errors (`Invalid input: expected object, received undefined; ...; Unrecognized keys: "version", "packages"`) were opaque enough that the engine source had to be re-read to recover. A pre-pass in `parseConfig` now detects each of those four mistakes by name and emits a hint that pairs the wrong shape with the right one, e.g. `top-level table is \`[[packages]]\` (plural) but should be \`[[package]]\` (singular)`. README's [Drop in `putitoutthere.toml`](./README.md#2-drop-in-putitoutthere-toml) section grew a four-row "wrong → right" table covering the same four traps so the docs and the engine name them the same way; a new `[!IMPORTANT]` callout in [Drop in `.github/workflows/release.yml`](./README.md#1-drop-in-githubworkflowsreleaseyml) warns consumers off `push: branches: [main]` triggers on lane CI workflows (which fire duplicate runs against the merge commit and contend for runners with `release.yml`); `1b.` was promoted from "Optional" to "Recommended" since `build.yml` is the cheapest place to catch a malformed config before merge. See [MIGRATIONS.md](./MIGRATIONS.md#friendly-config-error-hints).

- **pypi/maturin wheels now ship at the planned version instead of the literal in `pyproject.toml`.** The reusable workflow's build matrix (`_matrix.yml`) now bumps `[project].version` in `pyproject.toml` (or `[package].version` in `Cargo.toml` when `pyproject.toml` declares `dynamic = ["version"]`) to `matrix.version` before each `PyO3/maturin-action@v1` invocation. Maturin reads its version source from disk at build time and honors no env override — `SETUPTOOLS_SCM_PRETEND_VERSION` is a setuptools-scm / hatch-vcs feature, not a maturin one. Without the bump, wheels left the build runner at whatever literal happened to be in the consumer's manifest — diverging from the planned version, tripping PyPI's "file already exists" rejection at upload, and turning otherwise-clean release runs red even when crates and npm shipped correctly. The bump is implemented as a new internal `putitoutthere write-version` CLI subcommand and exposed through the JS action's existing surface (new `version:` input on `action.yml`); the e2e fixture harness now verifies wheel `METADATA: Version:` matches `matrix.version` post-build. The CLI subcommand and action input are internal — consumers compose with the reusable workflow, not directly with the CLI. Hit in the wild on `dirsql`'s 0.2.8 release (issue #276). See [MIGRATIONS.md](./MIGRATIONS.md#pypi-maturin-version-bump-at-build).

- **npm publish no longer fails red when npm CLI retries a successful PUT.** When the registry acks a publish but the response comes back flaky to the client (timeout / 502 / connection reset), the npm CLI retries with the same payload. The retry lands on a registry that already has the new version and exits `E403 "cannot publish over the previously published versions: <ver>"`. Both the platform-package handler (`src/handlers/npm-platform.ts:npmPublish`) and the main publish path (`src/handlers/npm.ts:publishImpl`) now detect that exact stderr shape and treat it as success — the package is already on the registry at the requested version. Hit in the wild on PR #257's polyglot-everything multi-mode publish (10 platform packages × ~1 in 10 chance per request meant the race was nearly guaranteed).

- **Crates publish no longer refuses on workflow-managed install state in sibling packages.** Before, the engine's pre-publish dirty-workspace check (`scanDirtyOutsideManifest`) flagged anything dirty outside the package's `Cargo.toml`. For polyglot consumers (rust + js in one repo), the reusable workflow's `Build npm packages` step (#256) creates `node_modules/`, `package-lock.json`, and `dist/` inside each npm package's path before cargo publish runs — these are workflow scratch, not stray edits, and cargo can't pack them anyway (it only packs files inside the crate's own dir). The check now whitelists every other configured package's path, similar to how it already whitelists `artifacts/`. Stray edits elsewhere in the repo (a `README.md` change, etc.) still fail the check. Hit in the wild on the polyglot-everything e2e fixture; would also have hit any consumer with the same shape.

- **Dogfood release workflow no longer silently downgrades `release: minor` to `patch`.** `release-npm.yml`'s "Fold action bundle into release commit" step now forwards the parent commit's body into the bundle commit, so any `release:` trailer the operator wrote in the merge commit survives into the new HEAD. Without the forward, `putitoutthere`'s publish-time plan re-derivation read HEAD (the bundle commit), saw no trailer on a single-parent commit, and defaulted the bump to `patch` — silently downgrading a `release: minor` to `0.x.(y+1)`. Hit in the wild on the 0.1.51 → 0.2.0 attempt that landed as 0.1.52. The reusable consumer-facing `release.yml` was unaffected (it never adds a commit between plan and publish). Internal-seam fix; no consumer-side action required.

## v0.1.51 → v0.2.0

### Added

- **`workflow_call` output `has_pypi`.** The reusable workflow now emits a string `'true'`/`'false'` indicating whether the planned matrix contains any `kind = "pypi"` rows. Consumers gate their caller-side `pypi-publish` job on this so non-PyPI repos paste the canonical template verbatim without paying any runtime cost. Computed in the `plan` job from the matrix output.
- **Reusable workflow `.github/workflows/release.yml` (`workflow_call`).** The single user-facing surface. Consumer integration is one `uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0` line in their own `release.yml`; pinned action versions, plan/build/publish orchestration, and GitHub Release creation all live inside. Three optional inputs: `environment` (default `release`), `node_version` (default `24`), `python_version` (default `3.12`). No `dry_run`, `working_directory`, or `config` inputs — the plan job is already side-effect-free, the config file is `putitoutthere.toml` at the repo root, period. The engine is invoked via `uses: thekevinscott/putitoutthere@v0` so the workflow file and the engine always agree on a single git ref.

- **`[package.bundle_cli]` recipe for maturin pypi packages** (#217). Opt-in declarative shape for libraries that ship a Rust CLI inside each wheel (the `ruff` / `uv` / `pydantic-core` pattern). Declare `bin`, `stage_to`, and optional `crate_path`; the reusable workflow cross-compiles the binary per target, stages it into the package source tree, and maturin picks it up via `[tool.maturin].include`. Requires `build = "maturin"` and non-empty `targets`. See [README → Recipes → Rust CLI inside a PyPI wheel](./README.md#rust-cli-inside-a-pypi-wheel). No behavior change for existing packages that don't declare the block.

### Changed

- **Reusable workflow + `action.yml` bumped to Node 24-compatible action majors.** GitHub deprecated Node 20 actions in September 2025; the runner forces Node 24 starting June 2, 2026 and removes Node 20 entirely on September 16, 2026. Bumps inside `.github/workflows/release.yml`: `actions/checkout@v4 → @v6`, `actions/setup-node@v4 → @v6`, `actions/setup-python@v5 → @v6`, `actions/upload-artifact@v4 → @v7`, `actions/download-artifact@v4 → @v8`. `action.yml` `runs.using: node20 → node24`. The canonical `pypi-publish` template in the README also bumps `actions/download-artifact@v4 → @v8` so consumers can paste a warning-free template; existing `@v4` copies in consumer workflows keep working but emit the deprecation warning in the caller's context. Artifact contract is unchanged: `download-artifact@v8` preserves the per-name subdirectory layout for downloads-by-name and `upload-artifact@v7`'s default behavior still produces zipped uploads keyed by `name:`. See [MIGRATIONS.md](./MIGRATIONS.md#reusable-workflow--actionyml-move-to-node-24-actions). (#253)

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

- **Reusable workflow's publish job now installs and builds npm packages before `npm publish` runs.** (#256)
  For vanilla npm rows the plan emits `artifact_path: package.json`, so
  the build job's `dist/` was never carried through to the publish job
  — which then ran `npm publish` from a fresh checkout and shipped
  tarballs missing the compiled output. Any consumer whose
  `package.json` declared `"files": ["dist", ...]` would publish a
  broken artifact (caught in the wild on a downstream consumer).
  The publish job now mirrors what a developer running `npm publish`
  locally would do: detect the lockfile, install deps, run `npm run
  build --if-present` per npm package path. napi / bundled-cli
  platform packages stage from `artifacts/` and were unaffected; this
  fix only changes the main-package path.

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
  shapes (e.g. `name = "py/foo"`, `"js/foo"`) used to
  produce `artifact_name` values containing `/`, which
  `actions/upload-artifact@v4` rejects with
  `The artifact name is not valid: ... Contains the following character: Forward slash /`,
  failing the build job before piot ever ran. The planner now encodes
  each `/` to `__` in `artifact_name` (so `py/foo` →
  `py__foo-sdist`) and config validation reserves `__` in
  `pkg.name` so the round-trip stays unambiguous. Other
  upload-artifact-forbidden characters (`\`, `:`, `<`, `>`, `|`,
  `*`, `?`, `"`) are now rejected at config load. Read sites
  (`publish`, `doctor`, `preflight`, `completeness`) consume
  `artifact_name` verbatim and need no changes; consumers running a
  prior `/`-encoding workaround should remove it once
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
