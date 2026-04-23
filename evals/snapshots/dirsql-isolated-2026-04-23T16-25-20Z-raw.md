## Existing release scope

dirsql ships a polyglot release: one Rust core publishes three artifacts (crate → crates.io, PyO3 wheels → PyPI, napi addons + bundled CLI → npm). The supporting code is non-trivial:

- **Workflows** (`.github/workflows/`): `patch-release.yml` (495 lines of orchestration: cron + push + dispatch triggers, change detection, dry-run, custom/changed/all selection), reusable `publish.yml` (375 lines: tag, 5-target wheel matrix, sdist, PyPI OIDC, crates OIDC + retry, GitHub release, conditional rollback), `publish-npm.yml` (262 lines: napi matrix + tarball download + sub-package synthesis + provenance publish + log dump), and `release.yml` (cargo-dist autogen, ~380 lines).
- **Python helpers** (`scripts/release/`): `compute_version.py`, `check_published.py` (pypi/crates/npm idempotency probes), `resolve_publish_targets.py` (per-package glob change detection) — all with paired `*_test.py`.
- **TS helpers** (`packages/ts/tools/`): `buildPlatforms.ts` + `buildLibPlatforms.ts` (synthesise `@dirsql/cli-*` and `@dirsql/lib-*` sub-packages), `syncVersion.ts` (inject `optionalDependencies` at publish time), each with tests.
- **`dist-workspace.toml`** for cargo-dist (binary archives only).

A lot of the surface is hard-won battle scars: the `patch-release.yml` filename is locked to OIDC trust policies (`patch-release.yml:1-4`); `aarch64-unknown-linux-gnu` requires a native arm runner because cross-link failed in v0.2.0 (`publish.yml:140-145`); `publish-pypi`'s gating requires every matrix row green to avoid shipping releases with missing-platform wheels (`publish.yml:226-235`); `rollback` only deletes the tag if both legs failed because crates.io is immutable (`publish.yml:351-364`); npm OIDC is inlined in `patch-release.yml` rather than reused because npm's trust policy validates the *caller* filename (`patch-release.yml:156-157`).

## piot fit assessment

piot is **explicitly designed for the dirsql shape** — the polyglot Rust handoff guide is literally titled "Polyglot Rust library (dirsql shape)" (`/guide/handoffs/polyglot-rust`). The publish-side concepts line up well, but there are two real blockers and several friction points.

### What piot already covers (replaces dirsql code 1:1)

| dirsql today | piot |
|---|---|
| `compute_version.py` (semver bump from latest tag) | trailer-driven (`release: patch\|minor\|major` in merge commit) |
| `resolve_publish_targets.py` (per-package change detection via globs) | `paths` glob + `depends_on` cascade in `putitoutthere.toml` |
| `check_published.py` (pypi/crates/npm 404 probe) | "Skip-if-already-published idempotency (each handler `GET`s the registry first)" — listed as ✅ in the handoff table |
| `publish.yml` topo ordering (Rust before wheel) | "Topologically order the publishes" — listed as ✅ |
| Crates OIDC + retry, PyPI OIDC, npm OIDC | "Per-registry OIDC trusted publishing" — listed as ✅ |
| `buildLibPlatforms.ts` + `syncVersion.ts` (napi family + optionalDeps top-level) | `build = "napi"` |
| `buildPlatforms.ts` (per-platform CLI sub-packages) | `build = "bundled-cli"` |
| `rollback` job | piot deliberately doesn't, replaced by pre-publish completeness check |

That's roughly 800 lines of YAML/Python/TS and the entire test suite for them. Real reduction.

### Blockers (would prevent adoption today)

**1. Mixed `bundled-cli` + `napi` under one top-level package.** This is THE blocker. dirsql's `dirsql` npm package's `optionalDependencies` mix `@dirsql/cli-<slug>` (binaries) AND `@dirsql/lib-<slug>` (napi addons) — confirmed in `packages/ts/tools/syncVersion.ts:40-44` and `packages/ts/ts/platforms.ts:41-95`. The Known Gaps page is explicit:

> *"piot cannot publish a single dirsql top-level whose optionalDependencies mix both `@dirsql/cli-<slug>` (CLI binaries via bundled-cli) and `@dirsql/lib-<slug>` (napi addons via napi). If you need that shape, split into two published names (e.g. `dirsql` for the napi library, `dirsql-cli` for the CLI)."* — `/guide/gaps#combined-cli--napi-under-one-top-level-package`

That's a published-API break for npm consumers. Not adoptable without either (a) splitting `dirsql` → `dirsql` + `dirsql-cli` on npm, or (b) piot growing a config that allows one `[[package]]` to declare both shapes feeding one optionalDeps block.

**2. OIDC workflow filename.** dirsql's three trust policies are registered against `patch-release.yml`. `putitoutthere init` writes `release.yml` (`api/cli` reference). The Known Gaps page explicitly calls this out and says `doctor` doesn't catch it (`/guide/gaps#doctor-does-not-validate-your-oidc-trust-policy`). Workaround: rename the scaffolded file or re-register on each registry — the latter requires admin clicks on crates.io/PyPI/npm and a brief publish-down window.

### Friction (would adopt, but with visible behavioural change)

**3. Tagging scheme.** piot tags `{name}-v{version}` per package; dirsql tags one shared `v{version}`. After cutover dirsql gets three parallel tags per release (e.g. `dirsql-rust-v0.3.1`, `dirsql-py-v0.3.1`, `dirsql-napi-v0.3.1`). Anything reading tags has to update — `gh release create --generate-notes` in `publish.yml:341-348` is the obvious one, plus any future install scripts.

**4. Cron trigger.** dirsql currently runs at 02:00 UTC daily via `patch-release.yml:11-13` and gates strategy on a `RELEASE_STRATEGY` repo variable (`immediate` vs `scheduled`). piot says: *"piot is not a cron-driven release orchestrator at the tool level (though you can run it from a cron workflow)"*. The Getting Started bump grammar is trailer-on-merge; a cron firing has no merge commit, so the cron workflow has to manufacture the bump (probably by passing `--bump patch` to whatever piot exposes — no doc on that surface). `--cadence scheduled` exists on `init` (CLI ref) but isn't documented in detail. Minor friction; almost certainly workable but not 100% mapped in the docs.

**5. Pre-build CLI staging.** dirsql's wheel ships the `dirsql` binary inside `packages/python/python/dirsql/_binary/` — the workflow stages `cargo build --bin dirsql --features cli` output before `maturin build` runs (`publish.yml:172-188`). The handoff guide acknowledges this: *"piot doesn't have a pre-build hook for this yet; the staging step stays in your build job"* (`/guide/handoffs/polyglot-rust#gotchas`). Fine — dirsql keeps that step in its own `build` job — but it means the workflow YAML doesn't shrink to nothing.

**6. Build matrix and runner selection stay in workflow YAML.** piot doesn't generate the matrix or pick `ubuntu-24.04-arm` for aarch64 (`/guide/gaps#per-target-github-actions-runner-selection`). All five `wheels-<target>` matrix rows in `publish.yml:130-152` and `build-napi` in `publish-npm.yml:30-89` stay. That's a meaningful chunk of the YAML that doesn't go away.

**7. `cargo-dist` stays.** piot doesn't emit binary archives for GitHub Releases (`/guide/gaps#standalone-binary-archive-uploads-to-github-releases`). dirsql still needs cargo-dist (or successor) to produce the `dirsql-*.tar.xz`/`.zip` archives that `buildPlatforms.ts` repackages into `@dirsql/cli-*`. So `release.yml` and `dist-workspace.toml` survive; piot composes alongside them.

**8. CLI distribution is npm-only.** `npx putitoutthere init` is the only documented install path. For dirsql's environment that's fine (Node is already there), but it's notable that a polyglot release tool ships only via npm.

### Tracked piot issues that could bite

- **#171** — `kind = "pypi"` doesn't handle `dynamic = ["version"]` `pyproject.toml`. dirsql is safe today: it uses static `version = "0.0.1"` rewritten by `sed` at build time (`publish.yml:159-162`). No bite.
- **#169** — `features = […]` on a `crates` package is silently dropped. dirsql's `cargo publish -p dirsql --allow-dirty` doesn't pass `--features`, so no bite. But the example config in the polyglot-rust handoff *uses* `features = ["cli"]`, which is misleading.
- **#170** — `targetToOsCpu` silently synthesises permissive os/cpu on unknown triples. Cosmetic for dirsql given its 5 known targets.

## Concrete conclusions

1. **Don't adopt today.** The combined-bundled-cli-and-napi gap is a hard blocker against the current `dirsql` npm package. Adopting forces an npm package rename, which is a published-API break.

2. **One change in piot unblocks adoption.** Allow a single `[[package]]` (or two linked `[[package]]` entries) to feed one top-level npm name with mixed `bundled-cli` + `napi` optionalDeps. This is the same pattern dirsql implements in `syncVersion.ts:40-44` — both name maps written into one `optionalDependencies` block. File this against piot.

3. **Re-register OIDC, don't rename.** Once #1 is unblocked, the cleanest cutover is: re-register trust policies on crates.io/PyPI/npm against `release.yml`, then `putitoutthere init`. Don't try to keep `patch-release.yml` — fighting piot's defaults will surface every time the scaffolder runs. The 30-minute trust-policy click-through is cheaper than carrying the divergence.

4. **Decide on the cron up front.** Either drop daily cron releases (let piot run trailer-driven on merges to main), or write a thin cron-only wrapper workflow that calls `putitoutthere publish` with an explicit bump. The docs don't show the latter — it'd be worth filing for a doc example.

5. **Expect ~50% YAML reduction, not 90%.** Realistic delete list: `compute_version.py`, `resolve_publish_targets.py`, `check_published.py` and their tests; `syncVersion.ts`, `buildLibPlatforms.ts`, `buildPlatforms.ts` and their tests (replaced by piot handlers); the `tag`/`publish-pypi`/`publish-crates`/`rollback`/`github-release` jobs in `publish.yml`; the `publish` job in `publish-npm.yml`. Realistic stay list: `release.yml` + `dist-workspace.toml` (cargo-dist for binary archives), the `wheels-<target>` matrix in `publish.yml`, the `build-napi` matrix in `publish-npm.yml`, the wheel pre-stage step (`publish.yml:172-188`), and runner selection. These are the bits piot explicitly disclaims.

6. **The "day of work" claim mostly holds, with caveats.** piot eats version computation, registry probes, OIDC ordering, and the napi/bundled-cli synthesis — that's where most of dirsql's day went. It does not eat: cross-compile matrix design, runner-OS choices for arm64 Linux/macOS, cargo-dist composition, the wheel pre-stage step, or first-time trust-policy registration. Those are the gotchas that will eat someone else's day next time.

### Bottom line for piot's roadmap (gap to fix before dirsql can adopt)

Add support — config schema + handler + docs — for one published npm name backed by per-platform sub-packages of *both* `bundled-cli` (CLI binaries) and `napi` (`.node` addons). Until then, the `dirsql` package on npm cannot migrate without a rename.
