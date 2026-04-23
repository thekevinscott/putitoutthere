# Evaluation

## Existing release machinery — scope

Release-specific orchestration in this repo is ~1,200 lines of YAML + ~300 lines of Python (+ tests):

| File | Lines | What it does |
|---|---|---|
| `.github/workflows/release.yml` | 296 | cargo-dist: binary archives → GitHub Release. **Out of piot's scope by design** — piot docs say "compose with cargo-dist". |
| `.github/workflows/patch-release.yml` | 262 | Top-level orchestrator: cron/push/dispatch triggers, change detection, calls `publish.yml`, runs npm inline. |
| `.github/workflows/publish.yml` | 374 | Tag compute, pypi build matrix, wheel/sdist, pypi publish, crates.io publish, rollback. |
| `.github/workflows/publish-npm.yml` | 176 | Napi matrix, downloads cargo-dist tars, synthesizes `@dirsql/cli-<slug>` + `@dirsql/lib-<slug>`, publishes top-level `dirsql` with combined `optionalDependencies`. |
| `.github/workflows/release-scripts.yml` | 42 | CI for the Python release helpers. |
| `scripts/release/*.py` | 294 (+ 372 tests) | `compute_version`, `check_published`, `resolve_publish_targets`. |
| `packages/ts/tools/*.ts` | 322 | `buildPlatforms`, `buildLibPlatforms`, `syncVersion`, `buildOne`, `buildLibOne`, `extract`, `findBinary`. |

So "a day of work to figure out the release process" is honest — `publish-npm.yml` alone is one of the most intricate release flows I've seen.

## What piot already covers (citing docs)

The piot docs literally have a "Polyglot Rust library **(dirsql shape)**" handoff guide (`/put-it-out-there/guide` sidebar → Handoff guides). Its coverage table says piot owns:

- Cascade (`paths` globs + transitive `depends_on`) — replaces `resolve_publish_targets.py` (129 + 214 lines of tests).
- Trailer-driven version bump — replaces `compute_version.py` (76 + 64 lines of tests).
- Topological publish order (crate → wheel → napi).
- OIDC trusted publishing on all three registries.
- Skip-if-already-published pre-check — replaces `check_published.py` (89 + 94 lines of tests).
- `kind = "pypi"` with `build = "maturin"` — absorbs `publish.yml`'s pypi-side `build` + `sdist` + `publish-pypi` jobs.
- `kind = "crates"` — absorbs the `publish-crates` job in `publish.yml`.
- `kind = "npm"` with `build = "napi"` — the `@dirsql/lib-<slug>` family in `publish-npm.yml`.
- `kind = "npm"` with `build = "bundled-cli"` — the `@dirsql/cli-<slug>` family in `publish-npm.yml`.
- Per-package tags + GitHub Release creation.

Piot leaves us, correctly, the build side: runner pinning (`ubuntu-24.04-arm`, `macos-14`, etc.), `maturin build --target …`, `napi build --target …`, and CLI staging into the wheel. That's exactly `publish.yml:130-199` and matches what the dirsql-shape guide tells us to keep.

## Hard blocker — and it's explicit in the docs

**Combined CLI + napi under one top-level `dirsql` package.** From `Guide → Known gaps → "Combined CLI + napi under one top-level package"`:

> "piot cannot publish a single `dirsql` top-level whose `optionalDependencies` mix both `@dirsql/cli-<slug>` (CLI binaries via `bundled-cli`) and `@dirsql/lib-<slug>` (napi addons via `napi`). If you need that shape, split into two published names."

We do exactly this shape. `packages/ts/tools/syncVersion.ts:40-45` injects both families into `dirsql`'s `optionalDependencies`; `publish-npm.yml:160-176` publishes everything under one top-level. **This is the one real blocker.** Three ways forward:

- **Option A — split npm names** (`dirsql` = napi, `dirsql-cli` = CLI launcher). Puts us fully inside piot's supported surface. Breaking change for any consumer running `npm install dirsql` for the CLI today.
- **Option B — change piot** to support a composite `build = "napi+cli"` family. Cleanest, but blocks on upstream.
- **Option C — hybrid.** piot handles crates + pypi; we keep `publish-npm.yml` as-is. Saves ~40% of the machinery (the hairiest file stays).

## Soft blockers / migration landmines

1. **OIDC filename is load-bearing.** `patch-release.yml:1-4` already calls this out — the trust policies on crates.io and npm pin that filename in the JWT. Piot's `init` scaffolds `release.yml`, and our cargo-dist workflow is *also* `release.yml`. We need a non-colliding name (e.g. `piot-release.yml`) and re-register the trust policy on each registry **before** cutover. `putitoutthere doctor` does not catch this (`Known gaps → "doctor does not validate your OIDC trust policy"`).

2. **npm is currently token-based, not OIDC.** `publish-npm.yml:163` uses `NPM_TOKEN`. Piot wants OIDC trusted publishers on the `@dirsql` scope and the `dirsql` name. One-time UI work, non-blocking but new.

3. **Trigger-shape change.** `patch-release.yml` supports cron-nightly-patch + push-on-main + `workflow_dispatch` with `publish_mode=all|changed|custom` and per-language booleans. Piot is merge-driven, trailer-overridden, patch-on-cascade. The `workflow_dispatch publish_mode=all` case (force-republish when we realize we shipped broken) becomes a human-authored `release: patch [dirsql-rust, dirsql-py, dirsql-napi]` trailer commit. Acceptable, but a maintainer-workflow change.

4. **Auto-rollback on partial failure goes away.** Piot deliberately doesn't delete tags (`Known gaps → "Auto tag-rollback on partial-publish failure"`) and relies on the pre-publish completeness check. `publish.yml:350-374` currently does this for us. Design choice we'd need to accept — defensible given crates.io immutability.

5. **Install path is `npx putitoutthere init`.** Fine for us (we run Node in CI anyway). Worth noting though: a polyglot release tool that ships only via npm is a minor smell for a Rust-heavy consumer.

## Non-blockers I confirmed

- `pyproject.toml` uses static `version = "0.1.0"`. Piot's #171 (dynamic-version pyproject) does not apply.
- `publish.yml` does `cargo publish -p dirsql --allow-dirty` with no `--features`. Piot's #169 (handler silently drops `features`) does not apply — we don't need it.
- CLI-binary-into-wheel staging (`publish.yml:172-188`) stays in our `build` job. The dirsql-shape guide explicitly says so; not a gap, just a responsibility split.

## Concrete conclusions

- **Fit: yes, strong.** Piot was literally designed with dirsql's shape in mind (there's a handoff guide named for it).
- **Adoptable today as written: only under Option A or Option C.** Option B (ideal) requires an upstream change to piot.
- **What piot needs to change to make adoption lossless for us:** one feature — support a composite top-level whose `optionalDependencies` pin both a `bundled-cli` family and a `napi` family under one published name. That's the delta between "day of work saved" and "same day of work, just rearranged around an npm split".
- **Nice-to-have upstream fixes:** `doctor` should look up the registered OIDC trust policy filename and warn on mismatch (closes the #1 cutover footgun for everyone, not just us); ship a `cargo install putitoutthere` so Rust-heavy repos don't need Node to install the tool.
- **Net code retired under Option A:** `resolve_publish_targets.py` + tests, `compute_version.py` + tests, `check_published.py` + tests (~666 lines Python), most of `publish.yml` + `publish-npm.yml` + `patch-release.yml` (~800 lines YAML). `release.yml` (cargo-dist) stays. Build-side matrix logic (runner pins, CLI staging, maturin/napi invocations) stays inside the piot-scaffolded `release.yml`.
- **Net code retired under Option C:** only the Python helpers (~666 lines), none of the YAML. ~40% of the win.

**My recommendation:** raise the combined-family case with piot (Option B) and, if it's not imminent, adopt Option A — split `dirsql` into `dirsql` + `dirsql-cli` on npm as part of the migration. The breaking change on npm is a one-time cost; keeping `publish-npm.yml` forever is a tax on every future change.
