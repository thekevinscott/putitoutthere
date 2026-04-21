# Handoff — migrate `thekevinscott/dirsql` onto `putitoutthere`

**Date**: 2026-04-21
**Status**: plan only; no code changes in dirsql yet
**Scope**: replace dirsql's current polyglot release machinery with a single `putitoutthere.toml` + `release.yml` that publishes all three packages via OIDC trusted publishing.

## What dirsql is today

Cargo workspace with three published artifacts, all from the same Rust core:

| Package path       | Registry  | Published name   | Build |
|---|---|---|---|
| `packages/rust`    | crates.io | `dirsql`         | plain cargo, `cli` is an opt-in feature |
| `packages/python`  | PyPI      | `dirsql`         | maturin (PyO3), targeted wheels |
| `packages/ts`      | npm       | `dirsql`         | napi-rs; the crate `dirsql-napi` is `publish = false` and emits a `.node` binary per triple |

Workspace layout:

```
Cargo.toml          # workspace members = [packages/{python,rust,ts}]
dist-workspace.toml # cargo-dist config (rust-only; the others are ignored by dist)
packages/ts/tools/  # custom napi platform packaging (buildLibPlatforms.ts, buildOne.ts, etc.)
packages/ts/package.json # wireit-driven build, scripts.prepublishOnly = `napi prepublish -t npm`
packages/python/pyproject.toml # maturin backend
.github/workflows/  # publish.yml (workflow_call), publish-npm.yml, release.yml, release-scripts.yml, patch-release.yml
```

Release today is a constellation: `release.yml` orchestrates version bumping + tagging, calls into `publish.yml` (which gates on `publish_pypi` / `publish_crates` booleans), with `publish-npm.yml` handling the napi matrix separately. That's 5 workflows doing what `putitoutthere plan` + `publish` do in one.

## Target state

- Single `putitoutthere.toml` with three `[[package]]` entries (cascade rules below).
- Single `release.yml` that runs `putitoutthere plan` → matrix → per-target artifact build → `putitoutthere publish`.
- All three registries authenticated via OIDC trusted publishing. Zero long-lived tokens in repo secrets.
- Old workflows disabled-but-present for one cycle (rename to `*.yml.off`) so rollback is a single rename.

## Step-by-step plan

Ordering matters because some steps are irreversible (npm + crates publish of a bootstrap version) and trusted-publisher registration has prerequisites.

### 1. Register trusted publishers (no code yet)

All three follow the same pattern as the `piot-fixture-zzz-*` canaries in this repo.

- **crates.io** — `dirsql` already exists on crates.io, so the trusted-publisher form is immediately available. Settings → Trusted Publishing → add: owner `thekevinscott`, repo `dirsql`, workflow `release.yml`, environment `e2e` (or whatever we land on). Delete `CARGO_REGISTRY_TOKEN` from repo secrets after the first trusted-publish run succeeds.
- **PyPI** — `dirsql` already exists. Settings → Publishing → add GitHub trusted publisher.
- **npm** — `dirsql` already exists. Access → Require trusted publisher → add.

After all three: test each in isolation by publishing a patch under the existing workflows with the tokens deleted; they should still succeed via OIDC. Only proceed past this step once all three are green.

### 2. Draft `putitoutthere.toml`

```toml
[putitoutthere]
version = 1
cadence = "immediate"

[[package]]
name  = "dirsql-rs"
kind  = "crates"
crate = "dirsql"
path  = "packages/rust"
paths = ["packages/rust/**", "Cargo.lock"]

[[package]]
name  = "dirsql-py"
kind  = "pypi"
pypi  = "dirsql"
path  = "packages/python"
paths = ["packages/python/**"]
build = "maturin"
targets = [
  # Mirror the current publish-npm.yml triples; start conservative and
  # expand once the canary is green.
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
]
depends_on = ["dirsql-rs"]

[[package]]
name    = "dirsql-npm"
kind    = "npm"
npm     = "dirsql"
path    = "packages/ts"
paths   = ["packages/ts/**"]
build   = "napi"
targets = [
  # Copy from packages/ts/tools/buildLibPlatforms.ts; whatever that
  # file walks is the source of truth.
  "x86_64-unknown-linux-gnu",
  "x86_64-unknown-linux-musl",
  "aarch64-unknown-linux-gnu",
  "aarch64-unknown-linux-musl",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
]
depends_on = ["dirsql-rs"]
```

Notes on the cascade rules:

- `dirsql-rs` ships whenever `packages/rust/**` or `Cargo.lock` changes.
- `dirsql-py` cascades on `dirsql-rs` because its PyO3 bindings are in the same Rust tree; a crate release should bump the wheel too.
- `dirsql-npm` cascades for the same reason — its napi crate consumes the library.
- Neither binding cascades the other (a python-only change shouldn't force a fresh npm publish).

Verify the `targets` list against `packages/ts/tools/buildLibPlatforms.ts` before shipping; I didn't walk every line of that tool.

### 3. New `release.yml`

Outline (not a literal copy-paste; adapt paths):

```yaml
name: Release
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: write  # for tagging
  id-token: write  # OIDC for all three registries

jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.plan.outputs.matrix }}
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v6
        with: { node-version: '24' }
      - run: npm i -g pnpm@9
      - run: pnpm dlx putitoutthere plan --json
        id: plan

  build:
    needs: plan
    if: needs.plan.outputs.matrix != '[]'
    runs-on: ${{ matrix.runs_on }}
    strategy:
      matrix:
        include: ${{ fromJson(needs.plan.outputs.matrix) }}
    steps:
      # per-kind build + artifact upload — mirror test/e2e/harness.stageArtifacts
      # for real artifact generation (cargo package, maturin build, napi build --target)
      ...

  publish:
    needs: [plan, build]
    runs-on: ubuntu-latest
    environment: release
    steps:
      - uses: actions/checkout@v6
      - uses: rust-lang/crates-io-auth-action@v1
        id: crates-auth
      - env:
          CARGO_REGISTRY_TOKEN: ${{ steps.crates-auth.outputs.token }}
        run: pnpm dlx putitoutthere publish
```

Two things to copy from piot's own `.github/workflows/e2e.yml`:

- The `crates-io-auth-action` step + `CARGO_REGISTRY_TOKEN: ${{ steps.crates-auth.outputs.token }}` wiring. npm + PyPI auto-detect OIDC, so no further env wiring needed.
- The `stageArtifacts()` pattern from `test/e2e/harness.ts`: the `publish` job needs real artifacts on disk under `artifacts/{artifact_name}/`. The `build` job is where real `cargo package`, `maturin build`, `napi build --target` run.

### 4. Disable the old workflows

Rename (don't delete):

```
.github/workflows/publish.yml         → publish.yml.off
.github/workflows/publish-npm.yml     → publish-npm.yml.off
.github/workflows/release.yml         → release.yml.off   # if it conflicts with the new one
.github/workflows/release-scripts.yml → release-scripts.yml.off
.github/workflows/patch-release.yml   → patch-release.yml.off
```

Rollback = `git mv *.off *.yml`. Leave for one release cycle, then delete.

### 5. Bump a patch and watch

First live publish is the smoke test. Bump `workspace.package.version` from `0.1.0` → `0.1.1`, commit to main, watch the new `release.yml` fire. Expected outcome: all three registries land at `0.1.1` within minutes, with no tokens in the run's env.

## Known gotchas

1. **napi matrix artifacts**. `putitoutthere`'s npm handler (see `src/handlers/npm-platform.ts` in this repo) synthesizes per-platform packages from `artifacts/{pkg.name}-{target}/`. dirsql's existing `buildLibOne.ts` / `buildLibPlatforms.ts` do something similar but assume `target/napi-artifacts/`. The migration can either (a) update dirsql's tools to emit into `artifacts/dirsql-npm-{target}/` or (b) add a shim step in `release.yml` that copies/renames. (a) is cleaner long-term.

2. **maturin target list for pypi**. The current dirsql publish-pypi path probably uses `maturin build --target ...` per triple; confirm whether the `targets` list in `putitoutthere.toml` needs to match that exactly, or whether there's a `universal2` macOS thing happening that `plan.md §12.2` doesn't handle.

3. **dist-workspace.toml**. Still targets only the Rust crate. Once putitoutthere owns publishing, decide whether to delete `dist-workspace.toml` entirely or keep `cargo-dist` for GitHub release tarballs (it's useful for CLI binary distribution independent of crate publish).

4. **`packages/rust`'s `cli` feature flag**. The current publish path is `cargo publish` which doesn't activate optional features. Putitoutthere's handler does the same (`cargo publish --allow-dirty --verbose`). No change needed.

5. **wireit / biome / pnpm**. dirsql's `packages/ts` uses wireit for builds and biome for lint. Nothing in putitoutthere cares about those — it just calls `npm publish`. Leave them alone.

6. **Version bumping**. dirsql currently uses something in `release-scripts.yml` to rev versions across the workspace. Putitoutthere's `plan` computes versions from cascade rules + last tag, then `publish` writes them via each handler's `writeVersion`. That should work, but verify the Python and napi crates both honor `version.workspace = true` — if they do, bumping the workspace version in `Cargo.toml` propagates automatically and `plan` can still handle the per-package decision.

## Pre-flight checklist before starting

- [ ] Trusted publisher registered on crates.io for `dirsql`
- [ ] Trusted publisher registered on PyPI for `dirsql`
- [ ] Trusted publisher registered on npm for `dirsql`
- [ ] Long-lived tokens deleted from dirsql's repo secrets
- [ ] Existing publish path confirmed working zero-token (one release cycle under the old workflows with no tokens)
- [ ] Baseline versions recorded for rollback reference

Once those are all green, start step 2. Expect the migration to take 2-3 cycles (each is one bump-and-watch); the first live publish will almost certainly turn up one thing about dirsql's build that doesn't line up with `putitoutthere`'s assumptions, and the iteration loop is the same red-fix-green-fix pattern the canary dogfood went through.

## Why bother

- Collapses 5 workflows into 1.
- Deletes `dist-workspace.toml` + `release-scripts.yml` + `packages/ts/tools/buildLibPlatforms.ts` as duplicate machinery.
- Zero long-lived tokens.
- Exercises `putitoutthere` on a real library, which is the second-adopter data point after `piot-fixture-zzz-*` fixtures — the first real test of the library's cascade semantics against a non-synthetic codebase.
