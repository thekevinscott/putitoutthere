## What dirsql's release machinery actually does today

The effective pipeline is ~500 lines of YAML + three Python helpers + three TS synthesis scripts:

- `.github/workflows/patch-release.yml` (top-level trigger, confusingly named "Release"): cron at 02:00 UTC + push-to-main + `workflow_dispatch`. Delegates bucketing to `scripts/release/resolve_publish_targets.py` which globs changed files into rust/python/js/docs flags, then calls the reusable `publish.yml`.
- `.github/workflows/publish.yml`: runs `compute_version.py` (patch/minor from latest `v*` tag), creates & pushes a shared `vX.Y.Z` tag, builds maturin wheels across 5 targets (staging the CLI binary into `packages/python/python/dirsql/_binary/` beforehand — publish.yml:172-188), publishes to PyPI via OIDC, publishes to crates.io via `rust-lang/crates-io-auth-action@v1` with a 3-attempt retry loop, creates a GitHub Release via `gh release create --generate-notes`, and has a `rollback` job that deletes the tag on dual failure.
- `.github/workflows/publish-npm.yml`: separate workflow because npm OIDC pins the caller filename. Builds napi for 5 targets, synthesizes both `@dirsql/cli-<slug>` (bundled CLI binary, via `tools/buildPlatforms.ts`) AND `@dirsql/lib-<slug>` (napi addon, via `tools/buildLibPlatforms.ts`), then `tools/syncVersion.ts:41-44` injects both into the top-level `dirsql` package's `optionalDependencies` and publishes.
- `.github/workflows/release.yml`: the separate cargo-dist-generated workflow, which only handles GitHub Release tarball attachments (triggered on tag push).
- `scripts/release/`: `compute_version.py`, `check_published.py` (registry pre-check to make re-dispatch idempotent), `resolve_publish_targets.py`.

The file named `patch-release.yml` is named that way specifically because the crates.io and npm trust policies pin the caller filename in the OIDC JWT — renaming it would break publishing (note at top of patch-release.yml:1-4).

## What piot already covers for dirsql's shape

Cited against the docs I walked (`/getting-started`, `/guide/concepts`, `/guide/configuration`, `/guide/handoffs/polyglot-rust`, `/guide/npm-platform-packages`, `/guide/trailer`, `/guide/auth`, `/guide/gaps`, `/api/cli`):

| dirsql today | piot replacement | Evidence |
|---|---|---|
| `resolve_publish_targets.py` glob bucketing | `paths = […]` on each `[[package]]` + `depends_on` cascade | concepts/cascade |
| `compute_version.py` (patch/minor from tag) | `release: patch\|minor\|major[ …]` commit trailer | trailer page |
| `check_published.py` registry probe | Built into every handler ("every handler's first move is isPublished") | concepts §Idempotency |
| OIDC to PyPI (`pypa/gh-action-pypi-publish`) + crates (`crates-io-auth-action`) | OIDC-first for all three registries, env-var fallback | auth page |
| `tools/buildLibPlatforms.ts` napi synthesis | `build = "napi"` + `targets = […]` | npm-platform-packages page |
| `tools/buildPlatforms.ts` CLI binary synthesis | `build = "bundled-cli"` + `targets = […]` | npm-platform-packages page |
| `syncVersion.ts` optionalDependencies injection | piot writes optionalDependencies last, pinned to the just-published version | npm-platform-packages page |
| Toposort of Rust → Python → TS | `depends_on` graph drives publish order | concepts §"Publishing order" |
| Tag + `gh release create` | `{name}-v{version}` tag + GitHub Release per package | concepts §"What piot covers" |

That is a real substantial chunk of dirsql's release code replaced by a `putitoutthere.toml` that looks almost identical to the example on `/guide/handoffs/polyglot-rust`.

## Hard blockers — piot cannot do these today

**1. The single-name `dirsql` npm package that bundles *both* CLI and napi is explicitly unsupported.**

`syncVersion.ts:41-44` injects both `@dirsql/cli-<slug>` (bundled CLI) and `@dirsql/lib-<slug>` (napi addon) into the same top-level `dirsql`'s `optionalDependencies`. piot's gaps page is unambiguous:

> "piot cannot publish a single `dirsql` top-level whose `optionalDependencies` mix both `@dirsql/cli-<slug>` (CLI binaries via `bundled-cli`) and `@dirsql/lib-<slug>` (napi addons via `napi`). If you need that shape, split into two published names (e.g. `dirsql` for the napi library, `dirsql-cli` for the CLI)."

The doc even names dirsql specifically. Options:
- **Split the npm name** into `dirsql` (napi library) + `dirsql-cli` (CLI binary) — breaks every existing `npm i -g dirsql` and every install doc.
- **Keep `publish-npm.yml` hand-rolled** and use piot only for crates + PyPI. Salvages ~70% of dirsql's release machinery but leaves the npm synthesis scripts in place.

**2. Piot scaffolds `.github/workflows/release.yml`; that filename is already taken by cargo-dist.**

Getting Started says `npx putitoutthere init` writes `release.yml`. dirsql's `release.yml` is the cargo-dist autogen (which we need to keep for curl-installable tarballs — piot docs explicitly say "compose with cargo-dist"). `patch-release.yml` is the name pinned in the existing crates.io and npm trust policies. Adopting piot requires either:
- Re-registering trust policies on both registries to match piot's `release.yml`, which means piot also has to coexist with cargo-dist under a non-colliding name — which `init` doesn't offer (no `--workflow-path` flag documented in `/api/cli`).
- piot growing a scaffold flag to choose the workflow filename. That is not in the CLI reference.

**3. Is piot actually installable?**

The docs are served from `http://localhost:29188` — a local preview. `npx putitoutthere init` assumes the package is on npm. Nothing in the docs I walked confirms a published version. **Unless `putitoutthere` (or `@something/putitoutthere`) is actually resolvable from `npm view`, every adoption path is blocked at step 1.** This is the single most important question to answer before anything else.

## Soft gaps — workable but visible changes

**4. Tag scheme changes from shared `v0.3.1` to per-package `{name}-v{version}`.** Gaps page flags this as "a visible behavioural change at adoption." Any install docs/scripts that parse `v*` tags (including cargo-dist's own tag-triggered workflow) need updating. dirsql's cargo-dist workflow is currently triggered on `'**[0-9]+.[0-9]+.[0-9]+*'` (release.yml:45) — that still matches, but the release-notes and install-script UX changes.

**5. No auto tag-rollback.** dirsql's current `rollback` job (publish.yml:350-374) deletes the tag on dual-leg failure. piot's design commitment is the opposite: rely on the completeness pre-check, bump-and-republish if a partial does happen. Drop the rollback job. Not a capability loss, a philosophy swap.

**6. Pre-maturin CLI staging has no hook.** dirsql builds the `dirsql` CLI binary with `--features cli` and stages it into `packages/python/python/dirsql/_binary/` before `maturin build`. The polyglot-rust handoff doc calls this out: "piot doesn't have a pre-build hook for this yet; the staging step stays in your build job." Fine — it stays in the user's build job where it already lives — but piot doesn't get to abstract it away.

**7. Scheduled + immediate hybrid cadence.** dirsql runs both a nightly cron and push-to-main immediate. piot's config has a single `cadence = "immediate" | "scheduled"`. Hybrid isn't explicitly addressed. You can still wire a cron trigger in your workflow wrapper, but it's not a first-class declarative mode.

**8. crates.io publish retry loop.** publish.yml:315-328 retries up to 3× with backoff. Nothing in the CLI reference or concepts says piot does retries. Unclear — not a blocker if not, but worth testing.

**9. `workflow_dispatch` dry-run UX.** dirsql's operator has a UI with `bump_type`, `publish_mode`, `publish_python/rust/js`, and `dry_run`. piot has `putitoutthere publish --dry-run` on the CLI and `putitoutthere doctor`, and scaffolds a `putitoutthere-check.yml` PR dry-run. The manual operator override story is a regression unless the scaffolded `release.yml` exposes these as dispatch inputs (not shown in docs).

**10. Feature-gated cargo publish known-broken.** Piot issue #169: `features` on `kind = "crates"` is in the schema but "handler silently drops it today." dirsql's `publish.yml:300` runs `cargo publish -p dirsql --allow-dirty` without `--features` (the `[cli]` feature is for `cargo build`, not publish), so this *doesn't* bite dirsql — but if anyone later wants features-gated publish, #169 has to ship first.

## Concrete recommendation

Before we do anything else, answer blocker #3: is `putitoutthere` actually publishable to / on npm today? Try `npm view putitoutthere` or whatever the real package name is. If no, piot isn't adoptable regardless of fit — that's the first thing to fix in piot itself.

Assuming it is, the honest path for dirsql is a **partial adoption**, not a full swap:

- Use piot for `dirsql-rust` (crates) and `dirsql-py` (pypi). Those are clean fits; you delete `compute_version.py`, `check_published.py`, `resolve_publish_targets.py`, most of `publish.yml`, and the `rollback` job.
- Keep `publish-npm.yml` + `tools/buildPlatforms.ts` + `tools/buildLibPlatforms.ts` + `syncVersion.ts` hand-rolled until piot grows the mixed-family shape (blocker #1). Track as an upstream piot feature request.
- Resolve the workflow-filename collision (blocker #2): ask piot for a `--workflow-path` or `--workflow-name` flag on `init`, or accept re-registering trust policies and renaming `patch-release.yml` → `release.yml` (which then *replaces* the cargo-dist-generated one — meaning you also need to move cargo-dist's generated pipeline into a differently-named file).
- Decide deliberately whether to adopt per-package tags. PARITY.md currently assumes lockstep; the tag split is a workflow-visible change worth calling out in an ADR.

**Three specific changes I'd push piot to make before the "day of work" promise is real for dirsql:**

1. Support mixed `napi`+`bundled-cli` families under one top-level package name, or at minimum document a first-class "use two published names" migration recipe with a working `dirsql` example.
2. Add a `--workflow-path` (or `--workflow-name`) flag to `putitoutthere init` so it doesn't clobber an existing `release.yml` and so the caller-filename pin survives adoption.
3. Make sure the package is installable from npm and the docs use the real package name, not a placeholder — the top-of-funnel friction right now is "does this thing actually exist yet?"
