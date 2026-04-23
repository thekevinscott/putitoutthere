# Evaluating piot for dirsql

## Scope of the existing dirsql release machinery

~1,700 lines across 13 workflow files + ~666 lines of Python helpers. The release-specific parts:

- **`.github/workflows/patch-release.yml`** (262 lines) — orchestrator. Fires on cron nightly, push-to-main, or workflow_dispatch; decides bump and calls `publish.yml`; inlines the npm job because npm OIDC validates caller filename. The filename is **load-bearing for OIDC** (comment at the top of the file).
- **`publish.yml`** (374 lines) — tag → maturin wheel matrix (5 triples) + sdist → PyPI → crates.io → GitHub Release → tag rollback on double-failure.
- **`publish-npm.yml`** (176 lines) — napi matrix → synthesize `@dirsql/cli-<slug>` (from cargo-dist tarballs) AND `@dirsql/lib-<slug>` (from napi binaries) → publish per-platform packages → rewrite top-level `dirsql` package with both sets in `optionalDependencies`.
- **`release.yml`** (296 lines) — cargo-dist-generated, binary tarballs attached to GitHub Release.
- **`scripts/release/*.py`** — `compute_version.py`, `check_published.py`, `resolve_publish_targets.py` (+ tests).

That's the "day of work" figure — clearly earned.

## What piot already covers (for this shape)

From `/guide/concepts`, `/guide/configuration`, and the `/guide/handoffs/polyglot-rust` page (which is explicitly written as "the dirsql shape"):

- ✅ **Cascade** via `paths` globs + transitive `depends_on`, publishing in topological order. Replaces `resolve_publish_targets.py` plus `publish.yml`'s job ordering.
- ✅ **Trailer-driven bumps** (`release: patch|minor|major|skip [pkgs]`). Replaces `compute_version.py`.
- ✅ **OIDC trusted publishing** on all three registries with env-var fallback (`CARGO_REGISTRY_TOKEN` / `PYPI_API_TOKEN` / `NODE_AUTH_TOKEN`). Matches what dirsql already uses.
- ✅ **Idempotency pre-check** (GET registry, skip if version exists). Replaces `check_published.py`.
- ✅ **npm platform-package families** via `build = "napi"` (for the lib) or `build = "bundled-cli"` (for the CLI) — synthesizes per-platform sub-packages + top-level `optionalDependencies`. Replaces `tools/buildPlatforms.ts`, `buildLibPlatforms.ts`, `syncVersion.ts`.
- ✅ **Python wheels via maturin** targeting a list of triples (`targets = [...]`).
- ✅ **Composition with cargo-dist** for the GitHub Release tarballs — explicitly called out as the intended pattern, so `release.yml` (cargo-dist) stays as-is.
- ✅ **`release: skip` trailer** replaces the `[no-release]` marker in `patch-release.yml`.

Roughly, `patch-release.yml` + `publish.yml` + `publish-npm.yml` + `scripts/release/*` (~1,100 lines) collapse to a ~50-line `putitoutthere.toml` and a piot-scaffolded `release.yml` where only the build matrix is dirsql's responsibility.

## Concrete blockers

### 1. CRITICAL — the mixed-family top-level npm package is explicitly unsupported

`/guide/gaps#combined-cli--napi-under-one-top-level-package`, verbatim:

> piot cannot publish a single `dirsql` top-level whose `optionalDependencies` mix both `@dirsql/cli-<slug>` (CLI binaries via `bundled-cli`) and `@dirsql/lib-<slug>` (napi addons via `napi`). If you need that shape, **split into two published names** (e.g. `dirsql` for the napi library, `dirsql-cli` for the CLI).

This is dirsql's current shape exactly. `publish-npm.yml:160-176` publishes both `target/npm-platforms/*` (CLI) and `target/npm-lib-platforms/*` (napi), then `syncVersion.ts` writes both into the single `dirsql` package's `optionalDependencies`. A user today runs `npx dirsql` (launcher dispatches to CLI) *or* `import … from 'dirsql'` (napi addon) — the same package.

Options:
- a. Split to `dirsql` (napi) + `dirsql-cli` (CLI). Breaks `npx dirsql` users; they'd need `npm i -g dirsql-cli` or similar.
- b. Ship mixed-family support in piot. Not on the roadmap; would need a new `build` mode or a way to attach multiple families to one top-level.
- c. Drop npm CLI distribution, rely on `cargo install` + cargo-dist tarballs.

None are zero-cost. **This is the migration's biggest single cost.**

### 2. CRITICAL — crates handler silently drops `features` (tracked, not shipped)

`/guide/gaps#not-yet-shipped`, issue #169:

> `kind = "crates"` handler: pass `features` through to `cargo publish`. Config schema has it; handler silently drops it today.

`dist-workspace.toml:23` pins `features = ["cli"]` for a reason: the `dirsql` bin is gated behind the `cli` feature so library consumers pull zero CLI deps. If piot publishes `dirsql` without `--features cli`, `required-features` silently skips the bin target — `cargo install dirsql` stops working. crates.io is immutable, so the mistake ships permanently.

**Hard blocker until #169 lands.** The dirsql handoff page already shows `features = ["cli"]` in its example config, so the guide is already ahead of the handler.

### 3. MEDIUM — workflow-filename migration for OIDC

dirsql's three trust policies are registered against `patch-release.yml` (comment at the top of that file is explicit). `putitoutthere init` writes `release.yml`. Per `/guide/auth` and `/guide/gaps#doctor-does-not-validate-your-oidc-trust-policy`, `doctor` can't catch a mismatch — the first publish fails with HTTP 400.

Work: re-register the trusted publisher on crates.io/PyPI/npm UIs before cutover. Not hard, but must be done first, and must be done in lockstep with the filename. There is no documented config option to make piot's scaffolded workflow keep the name `patch-release.yml` without post-edit.

### 4. MEDIUM — tag scheme change

Today: one shared `v{version}` tag per release (publish.yml:126). Piot tags each package as `{name}-v{version}` (e.g. `dirsql-rust-v0.3.1`, `dirsql-py-v0.3.1`) per `/guide/gaps#per-package-tags-not-a-single-shared-version`. Consequences:

- cargo-dist's `release.yml` trigger (`'**[0-9]+.[0-9]+.[0-9]+*'`, release.yml:45) still matches but now fires 3× per release; needs narrowing to the crate tag (`dirsql-rust-v*`) or cargo-dist will build tarballs three times.
- Any install scripts or docs that parse `v*` tags need updating (I didn't find user-facing ones in this repo, but `SUMMARY.md`/`ROADMAP.md` may reference them).

## Non-blockers worth mentioning

- **pyproject.toml dynamic versioning** (gap #171): not applicable — dirsql uses static `version = "0.1.0"` (packages/python/pyproject.toml:7).
- **Target-triple os/cpu narrowing** (gap #170): dirsql's 5 triples are all standard, should be in the supported set. Worth spot-checking the first publish.
- **Per-target runner selection** (`ubuntu-24.04-arm` for aarch64-linux): piot doesn't do this and documents that it won't — your workflow's matrix owns it. Fine; copy the current matrix into the scaffolded `release.yml`.
- **CLI-in-wheel staging** (publish.yml:172-188 copies `cargo build --bin` output into `packages/python/python/dirsql/_binary/` for maturin's `include`): piot has no pre-publish hook, but this is already a `build`-job step and stays one. The handoff page even calls this pattern out.
- **Docs-changes-cascade-everything** (resolve_publish_targets.py behavior where `docs_changed` triggers Python + Rust): under piot, either add docs globs to each package's `paths` (blunt), or handle it in trailer semantics. Behavioral change, not a blocker.

## Required changes to adopt piot (ordered)

1. **Resolve the npm shape question.** If dirsql keeps the mixed `optionalDependencies` family, piot is a non-starter. Either piot grows support (design change, not a quick fix) or dirsql splits the package name. **Decide this before anything else.**
2. **Land piot issue #169** (features passthrough in crates handler). Without this, the first piot-driven `cargo publish` ships a broken crate.
3. **Re-register OIDC trusted publishers** on crates.io / PyPI / npm against the filename you commit to (either keep `patch-release.yml` via post-init edit, or accept `release.yml` and re-register).
4. **Update cargo-dist's `release.yml` tag-trigger** from shared `v*` to `dirsql-rust-v*` so it fires once per release, not three times.
5. **Move existing build logic into the piot-scaffolded `release.yml`'s `build` job**: maturin matrix with `ubuntu-24.04-arm` row, napi matrix, pyproject.toml/Cargo.toml version-sed, `_binary/` staging step for the wheel. ~100–200 lines of YAML.
6. **Delete** `patch-release.yml`, `publish.yml`, `publish-npm.yml`, `scripts/release/*.py` + tests, `release-scripts.yml`. Net ~1,100 lines removed.

## Bottom line

Piot's in-scope set is a direct match for dirsql's release shape — that's not an accident; the handoff page is literally named for it. The migration math is worth doing **only if** the npm mixed-family blocker is resolved (by piot feature work, not by splitting the public package name — splitting is a user-visible regression that would cost more than keeping the current workflows). The crates `features` gap (#169) has to land too, but that's small and already-tracked.

If both of those ship in piot, dirsql's adoption cost is ~a day: re-register OIDC, narrow the cargo-dist tag trigger, move the build matrix into the scaffolded workflow, delete ~1,100 lines. That's the payoff the project was designed to deliver; right now it's gated by those two upstream items.
