# Evaluation: dirsql ↔ piot

## What dirsql currently has

A 13-workflow release apparatus held together by four moving parts:

1. **Trigger logic** — `.github/workflows/patch-release.yml:10-96`. Cron 2 AM UTC + push-to-main (gated by `vars.RELEASE_STRATEGY == "immediate"`) + manual dispatch. `[no-release]` in the commit message opts out. `publish_mode = all|changed|custom` on dispatch.
2. **Change detection** — `scripts/release/resolve_publish_targets.py:27-46`. Flat fnmatch buckets over `packages/rust/**`, `packages/python/**`, `packages/ts/**`, `*.md`. Docs change cascades to all three.
3. **Version compute + tag** — `scripts/release/compute_version.py` writes a single `v{X.Y.Z}` tag for the whole monorepo from the latest `v*` tag.
4. **Three publish paths, each with their own warts**:
   - **crates.io** (`publish.yml:268-328`): sed the workspace root `Cargo.toml` (because crates use `version.workspace = true`), `check_published.py` for idempotency, OIDC via `rust-lang/crates-io-auth-action@v1`, 3× retry with 15 s sleep.
   - **PyPI** (`publish.yml:130-266`): maturin matrix over 5 targets, plus a custom **"stage the Rust CLI binary into `packages/python/python/dirsql/_binary/` before maturin build"** step (`publish.yml:172-188`) so the wheel ships the compiled `dirsql` CLI. `CHANGELOG.md:28-37` calls this out explicitly.
   - **npm** (`publish-npm.yml` + `patch-release.yml:publish-npm`): two code paths. One downloads the cargo-dist archives, synthesizes `@dirsql/cli-<slug>` + `@dirsql/lib-<slug>` per-platform packages, publishes them, then publishes a top-level `dirsql` with `optionalDependencies` resolving to them (the esbuild/biome pattern). `tools/buildPlatforms.ts` + `buildLibPlatforms.ts` + `syncVersion.ts` do the heavy lifting.
5. A separate cargo-dist `release.yml` builds the per-target Rust tarballs on any `v*.*.*` tag and drives the npm platform-package publish via `workflow_run`.
6. **Rollback** (`publish.yml:350-374`): if *both* pypi and crates fail, delete the tag. Otherwise keep it (crates is immutable).

Scope: ~600 LOC of YAML + ~350 LOC of Python + ~1000 LOC of TypeScript build tooling. CHANGELOG line 24 describes this as "Distribution scaffolding" — a euphemism for what clearly took a day to get right.

## What piot covers

From `/getting-started/`, `/guide/{concepts,configuration,authentication,release-trailer,cascade}`, `/api/{cli,github-action,sdk}`:

| dirsql capability | piot coverage | Evidence |
|---|---|---|
| Three-registry publish (crates/pypi/npm) | ✅ first-class | Config `kind = "crates" \| "pypi" \| "npm"`, handlers docs |
| Glob-based change detection | ✅ better — two-pass resolver with transitive `depends_on`, cycle detection | Guide › Cascade |
| Monolithic version | ⚠️ replaced with **per-package tags** `{name}-v*.*.*` | Guide › Cascade › First release |
| Cron + push + dispatch triggers | ✅ `cadence = "immediate" \| "scheduled"` in config, push-to-main default | Configuration |
| `[no-release]` opt-out | ✅ upgraded to `release: skip` trailer + package scoping | Release trailer |
| manual minor/major bump | ✅ `release: minor` / `release: major [pkg]` commit trailer | Release trailer |
| `check_published.py` idempotency | ✅ every handler's first move is `isPublished` | Concepts › Idempotency |
| OIDC trusted publishing, all three registries | ✅ documented end-to-end with fallback precedence | Authentication |
| Retry / rollback semantics | ❓ not documented | — |
| maturin matrix build | ✅ `build = "maturin"` + `targets` | Configuration › `kind = "pypi"` |
| napi per-platform build | ✅ `build = "napi"` + `targets` | Configuration › `kind = "npm"` |
| **per-platform CLI packages** (`@dirsql/cli-*`) | ✅ `build = "bundled-cli"` for npm | Configuration › `kind = "npm"` |
| **Rust CLI binary inside the PyPI wheel** | ❌ no documented hook | — |
| Workspace `version.workspace = true` handling | ❓ not stated | — |
| PR dry-run CI | ✅ `init` scaffolds `putitoutthere-check.yml` | Getting Started |
| Config validation / auth preflight | ✅ `putitoutthere doctor` | CLI reference |
| SDK / programmatic use | ✅ `plan`/`publish`/`doctor`/`init`/`loadConfig` exports | SDK reference |
| GitHub Action | ✅ `thekevinscott/put-it-out-there@v0` | GitHub Action |

**The config model lines up point-for-point with dirsql's matrix** — `build = "napi"` / `build = "bundled-cli"` on the npm side exactly mirrors `publish-npm.yml`. If you're asking "does piot understand what dirsql is trying to do," the answer is yes.

## Adoption blockers (concrete, ranked)

### 1. Rust CLI inside the PyPI wheel — hard blocker

This is dirsql's most custom move and piot doesn't document it:

- `publish.yml:172-188` builds the `dirsql` bin per-target, copies it to `packages/python/python/dirsql/_binary/`, *then* runs maturin — so every wheel ships both the PyO3 extension and a platform-native `dirsql` executable. `CHANGELOG.md:32-37` confirms this is intentional and paired with a `dirsql._cli.main:main` console script.
- piot documents `kind = "pypi", build = "maturin", targets = [...]` (Configuration page) — no pre-build hook, no "bundle this sibling package's binary." `build = "bundled-cli"` exists but is scoped to `kind = "npm"`.

Without a fix on piot's side, adopting it means dropping CLI-in-wheel (behavioral regression — `pip install dirsql` loses its CLI) or keeping a custom out-of-band step.

**Action**: file an issue on piot for pypi+bundled-cli parity with npm — mirror the existing `bundled-cli` semantics. It's the one gap with no config workaround.

### 2. Availability is unverified — potential hard blocker

The docs are served from `localhost:53332/put-it-out-there/` (local VitePress preview), not a live URL. I tried to confirm both publishes and the sandbox blocked them:

```
npm view putitoutthere                            → blocked by permissions
curl https://registry.npmjs.org/putitoutthere     → blocked
curl https://api.github.com/repos/thekevinscott/put-it-out-there → blocked
```

If `putitoutthere` isn't on npm and `thekevinscott/put-it-out-there@v0` isn't on the Action marketplace, `npx putitoutthere init` and `uses: thekevinscott/put-it-out-there@v0` both fail — adoption is impossible until piot itself ships. **Run `npm view putitoutthere` and `gh api repos/thekevinscott/put-it-out-there` locally before anything else.** If either returns 404, everything downstream is dead.

### 3. Workspace-root Cargo.toml version-sync — verification gap

dirsql's member crates use `version.workspace = true`; the actual literal version lives in the repo-root `Cargo.toml`. `publish.yml:288` sed's that root file. piot's config has `path = <manifest dir>`; the docs don't say whether the crates handler walks up to find `[workspace]` and edits there. This is probably a 15-minute test on a branch, not a design blocker — but plan to find out before cutover.

### 4. Rollback / retry are undocumented — soft gap

dirsql's rollback (`publish.yml:350-374`) deletes the tag if *both* pypi and crates fail, and `cargo publish` retries 3× for crates.io indexing lag. piot's Concepts › "The loop" lists publish as the third step and tags *after* successful handler.publish — that probably obviates most of this. But "probably" isn't enough for a release pipeline. Confirm behavior on a failure path, or accept that piot's "tag-on-success, not tag-then-publish" ordering replaces your rollback job.

### 5. Migration cost — one-time, not a piot defect

Today's scheme produces a single `v0.X.Y` tag covering rust + pypi + ts. piot uses `{name}-v*.*.*`. That means the next release under piot is three tags (`dirsql-v…`, `dirsql-py-v…`, `dirsql-ts-v…`) and `CHANGELOG.md` needs restructuring. GitHub Releases change shape. Documentation links to tags break. Not a blocker, but not free — budget an hour for the docs + CHANGELOG cleanup.

## Recommendation

**Piot covers roughly 90% of what dirsql's current release machinery does, and where it overlaps it's cleaner (config-driven, trailer-based bumps, per-package versioning, `doctor`, two-pass cascade).** One feature — shipping the Rust CLI inside the PyPI wheel — has no documented piot story and requires upstream work (`bundled-cli` for `kind = "pypi"`). That feature is real (see `CHANGELOG.md:32-37`), so don't drop it silently.

Do this in order:

1. **Confirm piot is actually published** — `npm view putitoutthere` and check the GH Action marketplace. If either is missing, stop here.
2. **File one issue**: pypi + bundled-cli parity. This is the only piot-side gap that can't be worked around in config.
3. **Dry-run on a branch**: `npx putitoutthere init`, hand-write the TOML with three packages (`kind = crates`, `kind = pypi build=maturin`, `kind = npm build=napi` *and* a second npm package `build = bundled-cli` for `@dirsql/cli-*`), `putitoutthere doctor`, `putitoutthere plan`. Expect two things to fall over — workspace Cargo.toml version-sync (#3) and the missing pypi+bundled-cli hook (#1). Everything else should work.
4. **Cut over once #1 lands upstream**, not before. In the interim the current `patch-release.yml` is fine; it's ugly but it works.

Net: piot is the right bet. The day of work that produced dirsql's release pipeline is real and piot reclaims most of it. The one thing it doesn't yet reclaim is the thing dirsql invented specifically to be annoying — and that's fixable upstream in piot's existing `bundled-cli` abstraction.
