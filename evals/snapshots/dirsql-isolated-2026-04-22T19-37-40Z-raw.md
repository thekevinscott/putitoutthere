## Scope of the existing release process

dirsql's release machinery is non-trivial. The inventory:

**Workflows** (`.github/workflows/`):
- `patch-release.yml` — orchestrator. Daily cron + push-to-main + dispatch. Decides whether to release, detects which of `{rust, python, js, docs}` changed, then calls `publish.yml` and runs an inlined npm publish (inlined because npm OIDC doesn't work from reusable workflows).
- `publish.yml` — reusable. Tags, builds maturin wheels on a 5-target matrix, sdist, PyPI via OIDC (`pypa/gh-action-pypi-publish`), crates.io via OIDC (`rust-lang/crates-io-auth-action@v1`), GitHub Release, tag-rollback on double failure.
- `publish-npm.yml` — secondary path triggered by `workflow_run`; napi matrix build, downloads cargo-dist archives, synthesizes per-platform CLI + lib sub-packages, rewrites `optionalDependencies`, publishes `dirsql` + `@dirsql/cli-<slug>` + `@dirsql/lib-<slug>`.
- `release.yml` — cargo-dist autogen, builds Rust binaries + GitHub Release.
- `release-scripts.yml` — pytest + actionlint on the helper scripts.
- Plus `docs.yml`, `docs-test.yml`, `pr-monitor.yml`, and the 4 language CI workflows.

**Helper scripts** (`scripts/release/`): `compute_version.py` (regex tag → bump), `check_published.py` (pre-publish idempotency across all three registries), `resolve_publish_targets.py` (glob-based change detection), plus pytest suites for each.

**Inline rewriting at publish time**: sed on `packages/python/pyproject.toml`, sed on the root `Cargo.toml` (workspace version), and `syncVersion.ts` on `packages/ts/package.json` (version + `optionalDependencies` injection).

**Cross-package coupling**: npm publish depends on cargo-dist archives from the Rust release. Python wheels bundle the Rust binary in `packages/python/python/dirsql/_binary/`. Workspace uses `version.workspace = true` for unified versioning. Tag format is a single unified `v{X.Y.Z}`.

That's "a day of work to figure out" — matches your description. It's a lot of glue.

## What piot already covers for dirsql

Walking the docs, these pieces map cleanly onto what dirsql does today:

| dirsql concept | piot equivalent |
|---|---|
| `resolve_publish_targets.py` glob-based change detection | `[[package]]` `paths` globs + cascade resolver |
| `compute_version.py` bump from tag | trailer-driven planner; `release: patch\|minor\|major\|skip [pkg]` |
| `check_published.py` three-registry lookup | handler `isPublished` contract (docs: Concepts → Idempotency; API → SDK) |
| python/rust/npm coordination | `kind = crates\|pypi\|npm` + `depends_on` toposort |
| sed rewriting `pyproject.toml` / `Cargo.toml` / `package.json` | handler `writeVersion(pkg, version, ctx)` |
| maturin 5-target matrix | `kind = "pypi"`, `build = "maturin"`, `targets = [...]` |
| PyPI + crates.io OIDC | homepage claim "OIDC-first. Trusted publishers on all three registries." |
| napi per-platform build | `kind = "npm"`, `build = "napi"`, `targets = [...]` |
| `[no-release]` commit flag | `release: skip` trailer |
| daily 2am cron | `cadence = "scheduled"` in `[putitoutthere]` |
| `patch-release.yml` decision logic | `plan`/`publish`/`doctor` CLI + scaffolded `release.yml` |

The core ideas (cascade, trailer, plan/build/publish, idempotent handlers, toposort) are a direct match for what dirsql already does. If the docs were complete and the tool were installable, adoption would delete most of `scripts/release/` and the decision logic in `patch-release.yml`.

## Blockers — specific gaps that need to be fixed

### 1. Four documentation pages 404

- `/put-it-out-there/guide/authentication` — **404**, but it's in the sidebar and the homepage headlines "OIDC-first". Without this page, there is no documented way to tell piot "use OIDC trusted publisher for PyPI" vs "use `NPM_TOKEN` secret" vs "use the `crates-io-auth-action`". The `[[package]]` schema in Configuration has **no auth fields at all**. dirsql can't adopt piot without knowing where credentials plug in.
- `/put-it-out-there/api/github-action` — **404**, sidebar-listed. The Concepts page says the scaffolded `release.yml` runs "plan → build → publish" with "user-owned build steps" in the middle. The contract between piot's `plan` JSON matrix and the user's build job is **completely undocumented**. dirsql's whole matrix-build (maturin per-target, napi per-target, cargo-dist download) hangs off this contract.
- `/put-it-out-there/api/` — **404** (index).
- Sidebar link **"Release trailer"** points to `/guide/release-trailer` which **404s**; the page lives at `/guide/trailer`. Broken nav.

### 2. Schema gaps that directly block dirsql

- **`napi` + `bundled-cli` are mutually exclusive in the schema** (Configuration: `build = napi | bundled-cli. Omitted = vanilla`). dirsql's `packages/ts/` does **both** in a single npm package: napi library + cargo-dist CLI wrapper, stitched together via `optionalDependencies` in `syncVersion.ts`. Piot's `kind = "npm"` can't express this as written.
- **`bundled-cli` has zero semantics documented.** It's listed as a valid `build` value, nothing else. What binary source? cargo-dist archives? A sibling crates-kind package? This is dirsql's npm story — and there's no way to know if piot supports it.
- **No Rust-binary-in-wheel story.** dirsql's Python wheel bundles the Rust CLI in `packages/python/python/dirsql/_binary/` (workflow line ~172–188). Piot's pypi handler docs (`build = maturin`) cover wheels built from a PyO3 extension, but "take the Rust binary you just built for the CLI package and embed it in the wheel" isn't documented. This is not a maturin-default behavior.
- **Workspace version propagation is unspecified.** dirsql uses `[workspace.package] version = "0.1.0"` in root `Cargo.toml` and `version.workspace = true` in members. The `writeVersion` handler is documented as `Promise<string[]>` of touched files, but nothing says whether the `crates` handler writes the member's `Cargo.toml`, the workspace root, or both.

### 3. Feature gaps vs. current behavior

- **Tag format migration.** Piot's Cascade page says first-release detection uses tags matching `{name}-v*.*.*`. dirsql's history is plain `v{X.Y.Z}`. Adoption means either (a) dirsql's first piot release treats everything as "changed since beginning of time" and starts over, or (b) piot gains a config knob for tag schema. Not hard; just needs a decision and docs.
- **No documented rollback.** `publish.yml:373-374` deletes the git tag if both PyPI and crates.io publish fail. Piot's docs describe idempotency ("re-run failed releases") but not "undo a half-failed release." Probably fine — idempotent re-run is arguably better than rollback — but worth confirming explicitly.
- **`cadence = "scheduled"` is mentioned, not documented.** No cron field, no batching semantics, no interaction with trailer when multiple commits accumulate.
- **`doctor` preflight is undocumented.** Docs say it "validates config + per-package auth" and returns 0/1. Since the Authentication page 404s, there's no way to know what it actually checks.

### 4. Installability / toolchain

- Install path is `npx putitoutthere init`. dirsql already has Node in the stack (for the ts package), so this isn't a hard blocker, but it does mean piot is npm-distributed only — no PyPI CLI, no cargo install. Fine given dirsql's mix; worth knowing.

## Concrete conclusion

Piot is **conceptually the right tool** for dirsql — the trailer/cascade/toposort/handler model maps 1:1 onto what dirsql built by hand. If adopted, it would delete all of `scripts/release/`, collapse `patch-release.yml`/`publish.yml`/`publish-npm.yml` into a scaffolded `release.yml`, and replace three sed calls with declarative handler behavior.

But it **cannot be adopted today**. The blockers, in priority order:

1. **Fix the Authentication page (404)** — without it, nobody can configure OIDC for PyPI or crates.io, which is piot's stated headline feature.
2. **Fix the GitHub Action page (404)** — the plan↔build↔publish contract is undocumented, so there's no way to slot in dirsql's maturin/napi/cargo-dist matrix builds.
3. **Support dirsql's npm pattern**: a single npm package that's simultaneously a napi library and a cargo-dist-sourced CLI with per-platform `optionalDependencies`. Either extend `build` to allow `[napi, bundled-cli]` together or add a `composite` kind. And document `bundled-cli` at all.
4. **Document "embed Rust binary in Python wheel"** for the maturin pypi handler, or confirm that path is out-of-scope and dirsql must keep a custom step.
5. **Document workspace-version handling** for the crates handler (member vs workspace root).
6. **Fix the broken sidebar link** (`/guide/release-trailer` → `/guide/trailer`) and the `/api/` index 404.
7. **Decide the tag-format migration story** (accept a fresh first-release, or add a `tag_format` config field).

Items 1, 2, 3, 4 are hard blockers. Items 5, 6, 7 are polish. Until 1–4 are closed, "use piot instead" means reading source code rather than docs — which is exactly what the library was supposed to make unnecessary.
