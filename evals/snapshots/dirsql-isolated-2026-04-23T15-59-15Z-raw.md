# Evaluation: dirsql's release machinery vs. piot

## 1. Scope of current machinery

The release system is substantial — roughly **~1,000 lines of YAML and ~300 lines of Python/TS** spread across 4 workflows, 3 Python scripts, and 3 TypeScript tools:

| File | Role | LOC |
|---|---|---|
| `.github/workflows/release.yml` | cargo-dist auto-generated; Rust archive uploads to GH Releases | ~297 |
| `.github/workflows/patch-release.yml` | Daily cron + push-to-main + manual dispatch; change detection; fan-out | ~263 |
| `.github/workflows/publish.yml` | Tag + Python wheels (5×4 matrix) + PyPI + crates.io + GH Release + rollback | ~375 |
| `.github/workflows/publish-npm.yml` | napi build + per-platform sub-package synthesis + npm publish | ~177 |
| `.github/workflows/release-scripts.yml` | Tests for the release scripts themselves | ~43 |
| `scripts/release/compute_version.py` | Version bump logic (patch/minor) | ~77 |
| `scripts/release/check_published.py` | crates/PyPI/npm idempotency pre-checks | ~90 |
| `scripts/release/resolve_publish_targets.py` | fnmatch-based change detection | ~130 |
| `tools/buildPlatforms.ts` | Synthesize `@dirsql/cli-<slug>` from cargo-dist archives | – |
| `tools/buildLibPlatforms.ts` | Synthesize `@dirsql/lib-<slug>` napi sub-packages | – |
| `tools/syncVersion.ts` | Inject `optionalDependencies` into main `package.json` at publish time | – |

Non-trivial custom logic: **daily cron + change-detection + crates→PyPI→npm coordination + per-platform npm sub-package synthesis + idempotent retries + rollback-on-double-failure**. The user is right that this represents ~1 day of figuring-out and is a natural target for extraction.

## 2. What piot already covers (matches dirsql almost exactly)

piot's worked example is literally titled *"Polyglot Rust library (Rust crate + PyO3 wheel + napi npm) — the dirsql shape."* Direct mapping:

| dirsql file / concern | piot equivalent |
|---|---|
| `compute_version.py` | `putitoutthere plan` (trailer-driven; `release:` in merge commit) |
| `check_published.py` | Pre-publish completeness check, built-in |
| `resolve_publish_targets.py` (fnmatch globs) | `[[package]].paths` globs + `depends_on` cascade |
| `publish.yml` tag + publish job | `putitoutthere publish` |
| `publish-npm.yml` → `buildLibPlatforms.ts` + `syncVersion.ts` | `build = "napi"` synthesizes `@scope/pkg-<target>` sub-packages and injects `optionalDependencies` at publish time |
| `tools/buildPlatforms.ts` (CLI-bundled npm package) | `build = "bundled-cli"` packaging shape |
| Pre-staging Rust binary into Python wheel (`packages/python/python/dirsql/_binary/`) | Explicitly supported pattern — docs say "stage a `cargo build --bin …` CLI into the Python source tree before `maturin build` runs" |
| OIDC on all three registries | First-class; all three registries documented with fallback env-var tokens |
| Rollback on partial failure | Deliberately not done — uses pre-publish completeness check instead (crates.io immutability makes deletion unsafe, which matches dirsql's concern at `publish.yml:315-328`) |

**Net:** ~80% of dirsql's release machinery can be deleted. All three Python scripts go, both `buildLibPlatforms.ts` and `syncVersion.ts` go, `patch-release.yml`/`publish.yml`/`publish-npm.yml` collapse into piot's single scaffolded `release.yml`, and `release-scripts.yml` becomes obsolete.

## 3. Hard blockers — things that need to change before dirsql can adopt piot

### Blocker A — piot issue #169: `features` passthrough to `cargo publish` is silently dropped
**Evidence:** piot's Known Gaps page lists #169 explicitly — "`cargo publish --features` support — config schema has it; handler silently drops it today."
**Impact on dirsql:** The `dirsql` crate is published with `--features cli` (see `publish.yml` crates job, `dist-workspace.toml`). Without this, the published crate has no CLI. **This is a ship-stopper**; dirsql cannot adopt piot until #169 lands.

### Blocker B — Release cadence mismatch (cron vs. trailer)
**Evidence:** piot's fit checklist: *"Your release trigger is a merge commit (push to main). A commit trailer drives the version bump; piot is not a cron-driven release orchestrator at the tool level."*
**Impact:** dirsql's `patch-release.yml` runs on a **daily 2 AM UTC cron** (plus push-to-main and manual dispatch). piot does not model this. Two options:
- **Drop the cron.** Honestly, the cron adds near-zero value over push-to-main with `patch-on-cascade` default. This is the right migration.
- **Keep the cron** by scheduling `putitoutthere publish` from a cron workflow. piot's docs hand-wave this ("though you can run it from a cron workflow") without a worked example.

Recommendation: **drop the cron**. It's the forcing function behind much of the patch-release.yml / publish.yml split.

### Blocker C — Tag scheme migration: single vs. per-package
**Evidence:** piot fit checklist: *"comfortable with one tag per package (`{name}-v{version}`) rather than a single shared version across all packages."*
**Impact:** dirsql currently tags `v0.1.0` once per release; piot will tag `dirsql-rust-v0.1.0`, `dirsql-py-v0.1.0`, `dirsql-napi-v0.1.0`. This touches:
- `scripts/release/compute_version.py` (uses `LATEST_TAG` regex `v{major}.{minor}.{patch}`) — goes away
- Anything parsing tags for version discovery
- cargo-dist's `release.yml` triggers on tag pattern `**[0-9]+.[0-9]+.[0-9]+*` — needs to accept the new scheme or run off a different trigger

Note: the `[workspace.package] version` field in `Cargo.toml` no longer needs to be the authoritative single source — piot writes per-package versions. But dirsql's workspace inheritance pattern still works as long as all three packages happen to bump together (which they will, on cascade). **Migration is mechanical, not architectural.**

### Blocker D — cargo-dist coexistence
**Evidence:** piot's non-goals: *"standalone binary archives attached to GitHub Releases with a curl-installable tarball. That's cargo-dist's / goreleaser's lane; compose with them, don't replace them with piot."*
**Impact:** piot scaffolds `.github/workflows/release.yml`. cargo-dist *also* owns `.github/workflows/release.yml` (auto-regenerated; hand-edits get clobbered). These collide. Additionally, `publish-npm.yml` downloads cargo-dist archives and turns them into `@dirsql/cli-<slug>` sub-packages. Under piot's `build = "bundled-cli"`, the workflow must produce binaries that piot then packages — either by rebuilding in-workflow (simpler; drops `tools/buildPlatforms.ts`) or by fetching cargo-dist's uploaded archives (re-implements current behavior in the piot workflow).

**This is a real piot-docs gap**: "compose with cargo-dist" is stated as policy but has no worked example. Without one, the integration path is a ~half-day of figuring out — which partly defeats the purpose.

### Blocker E — npm OIDC workflow-filename constraint
**Evidence:** `publish-npm.yml` exists as a separate workflow specifically because *"OIDC validation requires caller workflow name, not called workflow."*
**Impact:** dirsql has registered `patch-release.yml` as the trusted publisher on npm. piot scaffolds `release.yml`. Switching to piot requires **re-registering the npm trusted publisher** to point at `release.yml`. This is a one-time console action, not a code change. Also: piot will need to emit a single flat workflow (no reusable-workflow indirection) to keep the filename invariant satisfied — the docs imply this is what it does.

## 4. Soft gaps (not blockers, but worth noting)

- **`release: skip` ↔ `[no-release]`** — equivalent. No work needed. ✓
- **Dynamic version in `pyproject.toml`** (piot issue #171) — dirsql uses static `version = "0.1.0"` in `packages/python/pyproject.toml`, so not affected today. Would matter if dirsql later switches to `hatch-vcs`.
- **Retry loop for crates.io transient failures** — dirsql has 3-attempt × 15s backoff (`publish.yml:315-328`). piot docs don't mention a retry; unclear if this is handled. Minor reliability concern.
- **Manual `CHANGELOG.md`** — piot defers to `release-please`. dirsql currently auto-includes `CHANGELOG.md` in GitHub Release body. Orthogonal; keep the manual approach or layer `release-please` in. No piot change needed.
- **Python wheel matrix (5 OS × 4 Python versions = 20 wheels)** — piot's `targets` array declares *what* to publish; the build matrix is still the workflow's job. That matches piot's stated split of responsibilities, but means dirsql's existing `publish.yml` build job (lines around `maturin build`) survives more or less intact, just invoked from piot's scaffolded workflow.
- **`doctor` doesn't verify trusted-publisher registration** — acceptable; one-time out-of-band setup.

## 5. Install story

`npx putitoutthere init` is clean. dirsql already has Node in the toolchain (it's an npm publishing target). No install blocker.

## 6. Concrete verdict

**piot is the right tool for dirsql and adoption is viable — but not today.** The tool is ~90% of the way there; the gaps are specific and fixable:

**Must fix in piot before dirsql can adopt:**
1. **Issue #169** — honor `features` in the crates handler. Without this dirsql ships a CLI-less crate. Non-negotiable.
2. **Add a worked cargo-dist composition example** to piot docs. The "compose with cargo-dist" policy is stated but not demonstrated; without an example, the half-day of figuring-out that piot is supposed to eliminate just moves into the integration step.

**Nice-to-have in piot:**
3. A worked example of `build = "bundled-cli"` that consumes cargo-dist archives (so `tools/buildPlatforms.ts` really can be deleted rather than ported into the workflow).
4. Acknowledge cron-triggered `putitoutthere publish` as a supported pattern with an example, OR explicitly document it as unsupported so consumers don't design around it.

**dirsql-side changes to land adoption (after the piot fixes):**
- Delete: all three `scripts/release/*.py` scripts and their tests, `release-scripts.yml`, `patch-release.yml`, `publish.yml`, `publish-npm.yml`, `tools/buildLibPlatforms.ts`, `tools/syncVersion.ts`. Likely also `tools/buildPlatforms.ts` once `build = "bundled-cli"` is wired.
- Add: `putitoutthere.toml` (three `[[package]]` stanzas: `dirsql-rust` / `dirsql-py` / `dirsql-napi` with `depends_on = ["dirsql-rust"]` on the latter two), `putitoutthere/AGENTS.md`.
- Migrate tag scheme from `v{X}.{Y}.{Z}` to `{name}-v{X}.{Y}.{Z}`.
- Drop the daily cron; rely on push-to-main + `release:` trailer.
- Re-register npm trusted publisher against the new workflow filename.
- Keep: `dist-workspace.toml` + cargo-dist (rename its workflow to e.g. `dist.yml`), `CHANGELOG.md`, pre-maturin binary staging in the build job, the Rust feature-gate canary.

**Rough estimate:** once piot #169 is fixed and the cargo-dist composition example is documented, porting dirsql is a **half-day** task and deletes ~1,000 lines of bespoke release machinery. That's a clean win and validates piot's reason to exist.
