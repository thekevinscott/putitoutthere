# Migration guide

How to upgrade between versions of `putitoutthere`. Sections are ordered
newest-first; each one is self-contained. Every observable change to
public API gets a section — additive changes as well as breaking ones —
because versioning is not yet strictly semver.

Each section covers five things, in order:

1. **Summary** — what changed and why.
2. **Required changes** — before/after diffs for config, CLI flags, and
   action inputs.
3. **Deprecations removed** — anything previously warned about that is
   now gone.
4. **Behavior changes without code changes** — same API, different
   runtime behavior (tag format, exit codes, default values).
5. **Verification** — commands you can run to confirm the upgrade
   worked, with the expected output.

---

## Unreleased

### Crates dirty-check whitelists sibling package paths

**Summary.** The engine's pre-publish dirty-workspace check
(`scanDirtyOutsideManifest` in `src/handlers/crates.ts`) used to
flag any dirty file in the repo outside the package's own
`Cargo.toml`. For polyglot consumers (rust + js in one repo), the
reusable workflow's `Build npm packages` step (added in #256) runs
`npm install + npm run build` for each npm package in the plan
before the engine publishes anything. That creates `node_modules/`,
`package-lock.json`, and `dist/` inside each npm package's path as
untracked files. cargo's git-status check sees them and the engine
refuses with `cargo publish: refusing to proceed; unexpected dirty
files in the working tree outside <crate>/Cargo.toml`.

The check now whitelists every other configured package's path
(`siblingPackagePaths` in `Ctx`), the same way it already
whitelists the reusable workflow's `artifacts/` scratch dir. cargo
only packs files inside its own package directory, so dirty state
in sibling packages can't end up in the crate tarball regardless.
Stray edits elsewhere in the repo (a `README.md` change, an
unrelated source file mod) still fail the check.

**Required changes.** None for consumers calling the reusable
workflow at `thekevinscott/putitoutthere/.github/workflows/release.yml@v0`.
This is a pure relaxation: setups that previously published cleanly
continue to; setups that hit the false-positive failure now succeed.

**Deprecations removed.** None.

**Behavior changes without code changes.** A polyglot release run
that previously failed with the "unexpected dirty files" message
on `node_modules/` / `package-lock.json` / `dist/` in a sibling npm
package now proceeds. The published crate tarball is unchanged
(cargo always scoped its packing to the crate dir).

**Verification.** A polyglot repo with rust + js packages and a
crates row in the matrix now reaches `cargo publish` instead of
the dirty-check error. After a release, the crate tarball still
contains only files inside the crate's own dir:

```sh
cargo package --list --manifest-path <crate>/Cargo.toml
```

### `publish` throws on empty matrix

**Summary.** `putitoutthere publish` previously logged
`publish: plan is empty; nothing to release` at info level and exited
0 when the matrix had no rows. The reusable workflow's `publish` step
went green on those runs even though nothing reached a registry —
visually indistinguishable from a successful release. The engine now
throws with code `PIOT_PUBLISH_EMPTY_PLAN`, the publish step exits
non-zero, and the run goes red. Skips remain a workflow-gate concern:
the canonical `release.yml` already has `if: …matrix output non-empty
…` on its publish job, so a `release: skip` trailer (or any other
empty-plan reason) skips the publish job rather than running it to a
no-op.

**Required changes.** None for consumers calling the reusable
workflow at `thekevinscott/putitoutthere/.github/workflows/release.yml@v0`.
The reusable workflow's existing `if:` on the publish job already
gates correctly. Hand-rolled workflows that invoked the CLI's
`publish` directly without a plan-output gate will now see a non-zero
exit on empty plans; add a gate or stop calling publish on commits
that don't produce work.

**Deprecations removed.** None.

**Behavior changes without code changes.** A release run that
reached the publish step with an empty plan used to log
`published: (nothing)` and exit 0; it now logs `[PIOT_PUBLISH_EMPTY_PLAN]
publish was invoked but the plan is empty…` to stderr and exits 1.
For repos whose release runs were silently no-op-ing (the dogfood
incident's failure mode), this surfaces the gap.

**Verification.** Trigger a release run that would produce an empty
plan (e.g. a commit that doesn't touch any package's `globs`) and
either bypass the workflow gate or invoke the CLI directly. Expect
exit 1, with `PIOT_PUBLISH_EMPTY_PLAN` in stderr. A healthy release
where the plan job's matrix is non-empty is unaffected.

### npm `build` accepts array of entries

**Summary.** `kind = "npm"` packages can now declare `build` as an array
of entries to publish multiple per-platform package families from a
single main package — for example, a napi-rs Node addon plus a CLI
binary, both selected via `optionalDependencies` on a shared top-level
package. Each entry has a `mode` (`napi` / `bundled-cli`) and an
optional `name` template (e.g. `"@dirsql/lib-{triple}"`) that the
consumer fully controls. The previous single-mode string form is
preserved.

**Required changes.** None. `build = "napi"` and `build = "bundled-cli"`
keep producing the same per-platform package names, the same artifact
directory layout, and the same matrix shape they did before. Adopt the
array form only if you need a multi-family npm package.

| Field | Before | After |
|---|---|---|
| `build` (single mode) | `build = "napi"` | unchanged — `build = "napi"` still valid |
| `build` (single mode, array form) | _new_ | `build = ["napi"]` — equivalent to the string form |
| `build` (single mode, custom name) | _new_ | `build = [{ mode = "napi", name = "@scope/lib-{triple}" }]` |
| `build` (multi mode) | _new_ | `build = [{ mode = "napi", name = "@scope/lib-{triple}" }, { mode = "bundled-cli", name = "@scope/cli-{triple}" }]` |

Variables in `name` templates: `{name}`, `{scope}`, `{base}`,
`{triple}`, `{mode}`. `{triple}` is required in every template.
`{version}` is not surfaced — platform package names are immutable
identifiers; the version is pinned via `optionalDependencies`.

**Validation rules** enforced at config load:

- Each `mode` value (`napi`, `bundled-cli`) appears at most once per package.
- Every `name` template must contain `{triple}`.
- Unknown placeholders are rejected.
- Templates across entries must be pairwise distinct (collision-free).

**Multi-mode artifact layout.** When `build` has more than one entry,
the build-side artifact directory and path get a mode infix to keep
families separate:

```
artifacts/
  dirsql-napi-linux-x64-gnu/         # napi family
  dirsql-bundled-cli-linux-x64-gnu/  # bundled-cli family
```

The build job for a multi-mode row writes to
`<pkg.path>/build/<mode>-<triple>/`. Single-mode (string form or
length-1 array) still uses `<pkg.path>/build/<triple>/` —
byte-for-byte unchanged.

**Trusted-publisher registrations.** Each platform package across
*every* family needs its own npm trusted-publisher registration. A
multi-mode package with N families × M targets needs N×M registrations
plus one for the top-level. There's no shorthand on npm's side; this
is the cost of the dual-family install pattern.

**Deprecations removed.** None.

**Behavior changes without code changes.** None for single-mode
configs. Multi-mode is new surface — no prior behavior to compare
against.

**Verification.** For an existing single-mode config, `putitoutthere
plan` should emit identical matrix rows before and after the upgrade
(same `artifact_name`, same `artifact_path`, same `target`). For a
new multi-mode config, you should see one matrix row per `(mode,
triple)` plus a single `target = "main"` row, and the matrix
`artifact_name` should carry the mode infix
(`<name>-<mode>-<triple>`).

---

## v0.1.51 → v0.2.0

### Publish job rebuilds npm packages from source

**Summary.** Vanilla npm packages were publishing with their compiled
output (`dist/`, `lib/`, etc.) missing from the tarball. The plan
emitted `artifact_path: package.json` for noarch npm rows, so the
build job's compile output was never uploaded — and the publish job's
fresh checkout had no compiled files. `npm publish` doesn't validate
`files` content, so the broken artifact reached the registry. Caught
in the wild as `cachetta@0.3.1`/`0.3.2`. The publish job now installs
deps and runs `npm run build --if-present` per npm package path
before invoking the engine — the same logic the build job already
runs, just at the point where it actually matters.

**Required changes.** None for consumers calling the reusable
workflow at `thekevinscott/putitoutthere/.github/workflows/release.yml@v0`.
The fix is internal to the reusable workflow.

**Deprecations removed.** None.

**Behavior changes without code changes.** The publish job now spends
additional time on `npm install` + `npm run build` for each npm
package in the plan. For repos whose package.json had no `build`
script, behavior is unchanged (`--if-present` skips). For repos that
did declare a build script, the published tarball now contains
whatever the build emits — which may be the first time the registry
artifact actually matches what the package author intended. If your
prior releases were unknowingly broken (compiled output missing), the
next release will fix them; verify by inspecting the next published
tarball with `npm view <pkg>@<ver>` + `npm pack <pkg>@<ver>`.

**Verification.** After upgrading, a release run logs an `npm
install + build at <path>` group per npm package in the plan. The
published tarball contains every directory listed in package.json
`files[]`:

```sh
npm pack <pkg>@<new-version> --dry-run 2>&1 | grep -E '(dist|lib|build)/'
```

### Reusable workflow + `action.yml` move to Node 24 actions

**Summary.** GitHub deprecated Node 20 actions in September 2025; the
hosted runner forces Node 24 starting June 2, 2026 and removes Node 20
entirely on September 16, 2026.
Every workflow run that called `putitoutthere` was emitting deprecation
warnings — one per job inside the reusable workflow, plus a top-level
`Actions running on Node.js 20` warning attributed to
`thekevinscott/putitoutthere@v0` itself, which the consumer could not
fix locally. The reusable workflow's pinned action majors and the JS
action's `runs.using` now target Node 24-compatible versions.

| Action | Before | After |
|---|---|---|
| `actions/checkout` | `@v4` | `@v6` |
| `actions/setup-node` | `@v4` | `@v6` |
| `actions/setup-python` | `@v5` | `@v6` |
| `actions/upload-artifact` | `@v4` | `@v7` |
| `actions/download-artifact` | `@v4` | `@v8` |
| `action.yml` `runs.using` | `node20` | `node24` |

**Required changes.** Consumers calling the reusable workflow at
`thekevinscott/putitoutthere/.github/workflows/release.yml@v0` get the
new pins automatically — no consumer-side YAML changes required. The
caller-side `pypi-publish` job in the canonical template now uses
`actions/download-artifact@v8`; existing copies still pinned at `@v4`
keep working but should be bumped to silence the same deprecation
warning in the consumer's own workflow file:

```diff
   pypi-publish:
     ...
     steps:
-      - uses: actions/download-artifact@v4
+      - uses: actions/download-artifact@v8
         with:
           pattern: '*-sdist'
           ...
-      - uses: actions/download-artifact@v4
+      - uses: actions/download-artifact@v8
         with:
           pattern: '*-wheel-*'
           ...
```

**Deprecations removed.** None.

**Behavior changes without code changes.** Reusable workflow jobs now
run under Node 24 instead of Node 20. The artifact contract is
unchanged — `download-artifact@v8` preserves the per-name subdirectory
layout (`artifacts/<artifact-name>/<file>`) for downloads-by-name, and
`upload-artifact@v7`'s default still produces zipped uploads keyed by
the `name:` parameter. `download-artifact@v8` now fails on artifact
hash mismatches by default (was a warning in `@v4`); this is an
integrity check, not a behavior change for healthy uploads.

**Verification.** A consumer release run no longer emits the
`Actions running on Node.js 20 ... thekevinscott/putitoutthere@v0`
deprecation warning, nor the per-job warnings against `actions/checkout@v4`
et al. Tag, GitHub Release, and registry uploads occur as before.

---

### PyPI uploads moved to caller-side job

**Summary.** PyPI's Trusted Publisher matching filters candidates by
`repository_owner` + `repository_name` *before* checking
`job_workflow_ref`
([Warehouse implementation](https://github.com/pypi/warehouse/blob/main/warehouse/oidc/models/github.py)).
The OIDC `repository` claim always reflects the caller's repo —
including inside a reusable workflow — so a TP registered against
the reusable workflow's repo is filtered out before workflow_ref
is even checked. PyPI documents this as unsupported
([troubleshooting](https://docs.pypi.org/trusted-publishers/troubleshooting/)).
Tracked at [pypi/warehouse#11096](https://github.com/pypi/warehouse/issues/11096),
no timeline.

To preserve OIDC trusted publishing for PyPI without setting
`PYPI_API_TOKEN`, the upload step (`pypa/gh-action-pypi-publish`)
now runs in the consumer's own workflow file as a second job,
gated on the new `has_pypi` output. The engine still owns plan,
build, version-rewrite, and git-tag creation for PyPI rows; only
the actual upload moves. See
[`notes/audits/2026-04-28-pypi-tp-reusable-workflow-constraint.md`](./notes/audits/2026-04-28-pypi-tp-reusable-workflow-constraint.md)
for the full diagnosis.

**Required changes.** Update `.github/workflows/release.yml`:

Before (~12 lines):

```yaml
name: Release
on:
  push:
    branches: [main]
jobs:
  release:
    uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0
    permissions:
      contents: write
      id-token: write
```

After (~30 lines, single copy-paste from README → Quickstart):

```yaml
name: Release
on:
  push:
    branches: [main]
jobs:
  release:
    uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0
    permissions:
      contents: write
      id-token: write

  pypi-publish:
    needs: release
    if: needs.release.outputs.has_pypi == 'true'
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    steps:
      - uses: actions/download-artifact@v8
        with:
          pattern: '*-sdist'
          path: dist/
          merge-multiple: true
      - uses: actions/download-artifact@v8
        with:
          pattern: '*-wheel-*'
          path: dist/
          merge-multiple: true
      - uses: pypa/gh-action-pypi-publish@release/v1
```

The `pypi-publish` job's `if:` gate skips it for non-PyPI repos —
paste verbatim regardless of what you publish. Crates.io and npm
are unaffected; their TP claim semantics work fine inside the
reusable workflow.

**No PyPI TP re-registration required.** Your existing TP
registration (against your repo, your `release.yml`, optional
environment) was already correct for this pattern. If you'd
attempted to register a TP against `thekevinscott/putitoutthere`
to work around the prior failure, remove that entry — it would
have never matched anyway.

**Deprecations removed.** None.

**Behavior changes without code changes.** PyPI upload step now
runs in the consumer's workflow context. The reusable workflow's
publish job no longer installs `twine` or `setup-python`; engine
log lines for PyPI rows now read "delegated to caller-side upload
step" instead of "authenticating via OIDC".

**Verification.** Push a release. The reusable workflow's
`release` job creates and pushes the git tag for PyPI rows; the
caller's `pypi-publish` job runs `pypa/gh-action-pypi-publish`
and uploads to PyPI. Check `https://pypi.org/project/<name>/<version>/`
to confirm.

---

### PyPI artifact discovery matches `{name}-sdist` and `{name}-wheel-` exactly

**Summary.** `src/handlers/pypi.ts:collectArtifacts` used a bare prefix
match (`entry.startsWith("{name}-")`) to find a package's artifact
directories under `artifacts/`. Sibling packages whose names extended
the same prefix (`foo` and `foo-extras`) collided: `foo`'s discovery
also picked up `foo-extras-sdist`, and twine then uploaded the sibling's
tarball under `foo`'s OIDC identity, failing PyPI's project-name check.
The handler now matches the sdist directory exactly (`{name}-sdist`)
and the wheel directories by `{name}-wheel-` prefix only — the two
shapes the planner documents in §12.4.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** Repos with multiple pypi
packages where one name is a prefix of another (e.g. `foo` and
`foo-extras`) no longer cross-upload artifacts. Single-package repos
and repos with non-overlapping names are unaffected.

**Verification.** A repo declaring both `foo` and `foo-extras` as
pypi packages publishes the correct tarballs to each project; neither
job uploads the other's artifacts.

---

### Reusable workflow's maturin sdist row uses `command: sdist`

**Summary.** The reusable workflow's pypi-maturin build step was a single
`PyO3/maturin-action@v1` invocation with `command: build` and an
`--sdist` flag conditional on the row being the sdist target. `maturin
build --sdist` is documented as "build a wheel AND an sdist" — the
sdist's artifact directory ended up containing both a `.tar.gz` and a
manylinux wheel, which collided at upload time with the per-target
wheel rows and aborted twine with `400 File already exists`. The build
step is now split into two: `command: sdist` for the sdist row
(sdist-only) and `command: build` with `--target` for wheel rows.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** Maturin packages with a
`sdist` row in their plan now upload a single `.tar.gz` from that row,
not a wheel-plus-sdist pair. Per-target wheel rows are unaffected.

**Verification.** A maturin-built package with `sdist` in `targets`
publishes to PyPI without `400 File already exists`. The sdist
artifact directory contains `.tar.gz` only.

---

### Synthesized npm platform packages inherit `repository`/`license`/`homepage`

**Summary.** npm's provenance verifier rejected platform-package tarballs
with `E422 Error verifying sigstore provenance bundle: Failed to validate
repository information: package.json: "repository.url" is ""`. The
synthesizer in `src/handlers/npm-platform.ts` previously wrote only
`name`/`version`/`os`/`cpu`/`files`/`main`/`libc` into the per-target
`package.json`. The publishing GitHub repo URL is bound into the
sigstore bundle by `npm publish --provenance`; npm cross-checks it
against `package.json.repository.url` at upload time, so an empty value
fails verification. Identity fields (`repository`, `license`, `homepage`)
are now read from the main package's `package.json` and copied into each
synthesized platform package. Affects `build = "napi"` and
`build = "bundled-cli"` packages.

**Required changes.** None — the fix is automatic. To benefit, ensure
the main package's `package.json` declares a `repository.url` that
matches the publishing repo (npm provenance has always required this for
the main package; platform packages now share the same expectation).

**Deprecations removed.** None.

**Behavior changes without code changes.** Per-target platform tarballs
on the registry now carry the same `repository`/`license`/`homepage`
values as the main package, instead of being absent.

**Verification.** A `build = "napi"` or `build = "bundled-cli"` package
publishes its platform tarballs to npm without `E422` provenance errors.
`npm view <pkg>-<target>@<version> repository` returns the main
package's repository URL.

---

### Reusable workflow's npm build step forces `shell: bash`

**Summary.** The build matrix can target Windows runners. GitHub Actions
defaults to `pwsh` for `run:` blocks on Windows, but the npm build's
shape detection (`if [ -f package-lock.json ]; then npm ci; elif ... fi`)
is bash syntax — PowerShell parsed it as a malformed expression and
aborted with `ParserError` before any package manager ran. The step now
sets `shell: bash` explicitly, which is portable across Linux, macOS,
and Windows runners (Git Bash ships on `windows-latest`).

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** Consumers whose plan includes
an npm package targeting Windows runners (e.g. native node-addon shapes,
`napi-rs` matrices) now succeed past the install step. Linux/macOS-only
matrices are unaffected — bash was already the default there.

**Verification.** An npm package with a Windows row in its plan
completes the install + build step on `windows-latest`; the job log
shows `Run if [ -f package-lock.json ]` executing under bash, not pwsh.

---

### Reusable workflow exchanges OIDC token for `CARGO_REGISTRY_TOKEN`

**Summary.** Crates publishes were failing with `error: no token found,
please run cargo login` — the reusable workflow was relying on cargo to
find an OIDC token in env, but cargo only consumes
`CARGO_REGISTRY_TOKEN` (a registry-issued bearer), not raw OIDC
ID-tokens. The publish job now runs `rust-lang/crates-io-auth-action@v1`
when the plan contains a crates row and exports its `outputs.token`
as `CARGO_REGISTRY_TOKEN` for the engine subprocess.

**Required changes.** None for consumers using the reusable workflow as
documented. Repos publishing to crates.io must have a configured trusted
publisher on crates.io pointing at their `release.yml` — same prerequisite
as before, just now actually exercised.

**Deprecations removed.** None.

**Behavior changes without code changes.** Crates publish in the
reusable workflow now reaches the registry; previously it failed at
the cargo invocation. JS/Python-only repos are unaffected — the auth
step is gated on `contains(needs.plan.outputs.matrix, '"kind":"crates"')`
and skips entirely when no crates row is in the plan.

**Verification.** A `kind = "crates"` package whose trusted publisher is
configured on crates.io now publishes successfully through the reusable
workflow. The publish job log shows the `Authenticate with crates.io
(OIDC)` step running before `putitoutthere publish`.

---

### Crates publish's pre-cargo dirty-tree check ignores `artifacts/`

**Summary.** The crates handler scans `git status --porcelain` before
invoking `cargo publish --allow-dirty`, refusing to proceed if anything
other than the managed `Cargo.toml` is dirty (the writeVersion bump
runs in the same job and would otherwise be the only legitimate dirty
file). The reusable workflow's `actions/download-artifact@v4` step
always creates `artifacts/` at the repo root before publish runs —
even for crates-only fixtures that have nothing to download — and the
pre-check was rejecting on `?? artifacts/`. The scan now treats the
engine's own `artifactsRoot` as managed scratch space and skips files
under it.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** Crates publishes that
previously errored with `unexpected dirty files in the working tree
outside <Cargo.toml>: - artifacts/` now proceed to `cargo publish`.
Stray edits anywhere else in the tree still fail the check.

**Verification.** A `kind = "crates"` package in a repo whose only
"dirty" file (alongside the managed `Cargo.toml`) is the engine's
`artifacts/` directory now reaches cargo. `git status --porcelain`
showing `?? artifacts/` is no longer fatal.

---

### Crates publish no longer fails the pre-publish completeness check

**Summary.** Consumers with a `kind = "crates"` package previously hit
`Artifact completeness check failed: missing artifact directory
<name>-crate/` before cargo was ever invoked. The reusable workflow
does not upload a `.crate` artifact (cargo packages and uploads from
source on the registry side), so the file the check demanded never
existed in the pipeline. The completeness check now skips crates
rows. Same reasoning as vanilla npm rows, which were already skipped.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** Crates publishes that
previously errored at the completeness gate now reach `cargo publish`.
A crates row whose source tree is genuinely broken still fails — the
failure just happens at the cargo step, not before.

**Verification.** A `kind = "crates"` package in
`putitoutthere.toml` no longer requires any artifact upload step in
the consumer's workflow. Trigger a release with a `release: patch`
trailer; the publish job's "Run putitoutthere publish" step should
log `crates: cargo publish ...` instead of aborting on completeness.

### `[[package]].paths` renamed to `globs`

**Summary.** The `path` / `paths` pair in `[[package]]` was confusing —
singular and plural differed only in a trailing `s` while meaning two
unrelated things (the package working directory vs. the cascade-trigger
globs). Renaming `paths` → `globs` removes the trailing-S collision.

**Required changes.**

| Before | After |
|-----|-----|
| `paths = ["src/**", "pyproject.toml"]` | `globs = ["src/**", "pyproject.toml"]` |

Every `[[package]]` block in `putitoutthere.toml` needs the rename.
Configs declaring `paths` now fail validation under `.strict()`.

**Deprecations removed.** None.

**Behavior changes without code changes.** None — the field's semantics
are unchanged.

**Verification.** `pnpm exec putitoutthere plan` (or the next reusable-
workflow run) loads cleanly. A config still declaring `paths` fails
load with a Zod error pointing at the unknown key.

### Removed: diagnostic CLI surface, GitHub-App auth, trust-policy validation

**Summary.** Eight things removed in one pass, none consumer-observable
under the new "reusable workflow + OIDC-only" surface:

- `[package.trust_policy]` config block (false security: typo-catcher
  for npm/PyPI; the only real check was the crates.io registry
  cross-check, which required a separate token most consumers wouldn't
  set up).
- `putitoutthere doctor` subcommand (its main job was the trust-policy
  validation above).
- `putitoutthere preflight` subcommand (the internal `requireAuth`
  gate inside `publish` is preserved).
- `putitoutthere token list/inspect` subcommands (operator-debugging
  surface for long-lived registry tokens — none exist under OIDC-only).
- `putitoutthere auth login/logout/status` subcommands + the
  `putitoutthere-cli` GitHub App's device-flow plumbing + the keyring
  (only purpose was powering `token list --secrets`).
- `src/release.ts` engine-side GitHub Release creation (duplicated by
  the reusable workflow's `gh release create --generate-notes` step).
- `publish --preflight-check` flag (deep token-scope check for
  long-lived tokens; OIDC-only renders it moot).
- Dead config fields: `cadence`, `agents_path`, `smoke`,
  `wheels_artifact` — defined in the schema, never read.

Net: ~2,800 lines of source removed, ~17% of `src/`.

**Required changes.**

| Before | After |
|-----|-----|
| `[package.trust_policy] workflow = "release.yml"` | Delete the block. Workflow renames still produce HTTP 400 from registries — same UX every other tool gives you. |
| `putitoutthere doctor` / `preflight` / `token` / `auth` invocations in any consumer script | Remove. None of these are reachable through the reusable workflow; consumer-facing surface is the workflow itself. |
| `cadence`, `agents_path`, `smoke`, `wheels_artifact` fields in `putitoutthere.toml` | Delete. They were never consumed; configs declaring them now fail validation under `.strict()`. |
| `--preflight-check` flag passed to `publish` | Drop. Internal `requireAuth` still gates publish. |

**Deprecations removed.** Everything in the list above.

**Behavior changes without code changes.** Engine behavior on the
plan / publish path is unchanged. `requireAuth` (the gate that
catches missing OIDC env or missing token) still runs; the deep
scope check (which required a long-lived token to inspect) no
longer runs because there's no long-lived token to inspect. GitHub
Release creation moves entirely to the reusable workflow's
`gh release create` step — engines invoked outside that workflow
(local dry-runs, custom integrations) no longer create Releases.

**Verification.** A consumer who never used any of the removed
surfaces sees no observable change. Consumers who used `doctor` or
`token` subcommands see exit-1 + "unknown command"; switch to the
reusable workflow.

### Public surface collapsed to a reusable workflow

**Summary.** The consumer surface is now one line in a `release.yml`:

```yaml
on:
  push: { branches: [main] }

jobs:
  release:
    uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0
    permissions:
      contents: write
      id-token: write
```

Plus the consumer's existing `putitoutthere.toml`. Triggers live in
the consumer's file; everything below them — pinned action versions,
plan/build/publish orchestration, runner toolchain setup, artifact
upload/download, GitHub Release creation — lives in the reusable
workflow that piot ships. The CLI and the JS action are internal
seams the reusable workflow invokes; consumers do not call them.
Auth is OIDC trusted publishers only — long-lived registry tokens
are not reachable through the workflow. See [design
commitments](https://github.com/thekevinscott/putitoutthere/blob/main/notes/design-commitments.md)
for the authoritative non-goals.

**Required changes.**

| Before (hand-written `release.yml`) | After |
|-----|-----|
| ~100 lines of YAML: plan/build/publish jobs, twine install, git identity, GitHub Release backfill, hand-pinned action majors | `uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0` |
| `putitoutthere init` to scaffold the workflow | Subcommand removed; consumers add the snippet above by hand |
| `[[package]].build_workflow = "publish-foo.yml"` for unsupported shapes | Removed. Shapes that don't fit piot's named build modes write their own release workflow that doesn't use piot |
| Long-lived registry tokens (`NPM_TOKEN`, `PYPI_API_TOKEN`, `CARGO_REGISTRY_TOKEN`) passed to a hand-written publish step | Not reachable through the reusable workflow. Register an OIDC trusted publisher per registry once |
| Optional inputs `dry_run`, `working_directory`, `config` | Removed. Plan job already prints the matrix without side effects; config lives at `putitoutthere.toml` in the repo root, no override |
| Documentation site (`docs/`) | Removed. README is the single user-facing surface; `notes/internals/` holds the contracts the reusable workflow honors so consumers don't have to know them |

**Deprecations removed.** `build_workflow:` is no longer in the
config schema (`src/config.ts`); configs that declare it now fail
validation. `putitoutthere init`, `--cadence`, and `--force` flags
are removed from the CLI.

**Behavior changes without code changes.** Engine behavior (plan,
cascade, version bump, registry handlers, completeness check,
idempotency, OIDC trust-policy validation) is unchanged. The
reusable workflow internally pins:

- `actions/checkout@v4` (`fetch-depth: 0`)
- `actions/setup-node@v4`
- `actions/setup-python@v5`
- `actions/upload-artifact@v4`
- `actions/download-artifact@v4`
- `PyO3/maturin-action@v1`

If a consumer was running newer majors (e.g. coaxer hit
`download-artifact@v8` defaults that broke the artifact-naming
contract), the reusable workflow standardises everyone on the
known-tested versions.

**Verification.**

- `pnpm test:unit` passes in the main repo.
- A consumer's first cutover: drop in the 12-line `release.yml`
  shown above, push a commit that touches a `[[package]].globs`
  glob, and watch for a tag push + GitHub Release on the next
  workflow run.

### Publish path works end-to-end for slash-containing `pkg.name`

**Summary.** Follow-up to the [`/`-encoding fix](#package-names-with--no-longer-need-an-encode-decode-workaround)
([#230](https://github.com/thekevinscott/putitoutthere/issues/230)).
Two bugs prevented slash-containing names from actually publishing
even after the planner started encoding `/` to `__`
([#237](https://github.com/thekevinscott/putitoutthere/issues/237)):

1. The pypi handler (`src/handlers/pypi.ts`) and the npm-platform
   synthesizer (`src/handlers/npm-platform.ts`) both built artifact
   directory lookups from the raw `pkg.name`, so a package called
   `py/foo` couldn't match the encoded on-disk directory
   `py__foo-sdist/`. Symptom: `pypi: no artifacts found for py/foo
   under <root>` at publish time.
2. The planner emitted glob-shaped `artifact_path` values for crates
   tarballs, pypi sdists, and pypi wheels (e.g.
   `${pkg.path}/dist/*.tar.gz`). `actions/upload-artifact@v4` treats
   a glob `path:` differently from a directory `path:` — it preserves
   the workspace-relative path, so the sdist landed at
   `artifacts/<name>/packages/python/dist/foo.tar.gz` instead of
   `artifacts/<name>/foo.tar.gz`. Even after fix (1), the publish
   handler couldn't find files inside that nested layout.

Both fixed:

- Handlers route directory lookups through `sanitizeArtifactName`,
  matching whatever the planner emitted on the matrix row.
- Handlers walk the artifact directory recursively for the expected
  file extensions (`.tar.gz` / `.whl` / `.crate`), so any layout
  (flat or nested) works.
- Planner emits directory-shaped `artifact_path` values for the
  three slots that used a glob:

  | Slot | Before | After |
  |---|---|---|
  | crates tarball | `${pkg.path}/target/package/*.crate` | `${pkg.path}/target/package` |
  | pypi maturin wheel | `${pkg.path}/dist/*.whl` | `${pkg.path}/dist` |
  | pypi sdist | `${pkg.path}/dist/*.tar.gz` | `${pkg.path}/dist` |

**Required changes.**

- **None for repos that pass `matrix.artifact_path` straight through**
  to `actions/upload-artifact@v4` (the canonical pattern shown in
  `docs/guide/shapes/*`). The matrix field already carries the new
  directory shape; on-disk artifact layout becomes flat
  (`<name>/foo.tar.gz` instead of `<name>/packages/python/dist/foo.tar.gz`),
  but consumer workflows see no observable change.
- **Repos that hand-coded a glob path** should switch to the
  directory shape (or — better — replace the hard-coded value with
  the matrix field):

  ```diff
   - uses: actions/upload-artifact@v4
     with:
       name: ${{ matrix.artifact_name }}
  -    path: packages/python/dist/*.tar.gz
  +    path: ${{ matrix.artifact_path }}     # or "packages/python/dist"
  ```

  The recursive reader keeps glob layouts working as a safety net,
  but the directory shape is the canonical contract going forward.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- Artifact directory layout is now flat: `artifacts/<name>/<file>`
  instead of `artifacts/<name>/<workspace-relative-path>/<file>`.
  Anything reading the artifact tree (the docs page, debugging
  scripts, custom verification jobs) should expect files at the
  artifact root.
- The publish-side handlers now walk subdirectories recursively
  when looking for `.whl` / `.tar.gz` / `.crate` files. This is
  defensive for consumers whose build steps write to a non-standard
  location inside `<name>/`; the planner's directory `artifact_path`
  remains the canonical contract.

**Verification.**

```sh
putitoutthere plan --json | jq '.[] | {name, artifact_name, artifact_path}'
```

Expect every `artifact_path` to be a plain directory (no `*`):

```json
{ "name": "py/cachetta", "artifact_name": "py__cachetta-sdist", "artifact_path": "py/cachetta/dist" }
```

After the next release run, the `actions/upload-artifact@v4` step
uploads `py/cachetta/dist/` contents flat under
`artifacts/py__cachetta-sdist/` (no nested `packages/python/dist/`
prefix), and the publish step finds the sdist immediately.

### Scaffolded `release.yml` now forwards `GITHUB_TOKEN`

**Summary.** piot has supported cutting a GitHub Release alongside each
tag push since #26, but the scaffolded `release.yml` template never
forwarded `GITHUB_TOKEN` to the publish step. GitHub Actions does not
auto-mount the runner token as an env var — `permissions: contents:
write` only grants the token *scope* to write Releases; the token still
has to be exposed via `env:` for piot's `release.ts` to read it from
`process.env.GITHUB_TOKEN`. Without it, piot silent-skipped Release
creation and consumers got tags but no Release entries on the repo's
Releases page. Fresh `piot init` runs now scaffold the env line.

**Required changes.** Existing repos that ran `piot init` before this
change need a one-line addition to `.github/workflows/release.yml`:

```diff
       - uses: thekevinscott/putitoutthere@v0
         with:
           command: publish
           dry_run: ${{ inputs.dry_run || 'false' }}
         env:
           NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
           CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}
           PYPI_API_TOKEN: ${{ secrets.PYPI_API_TOKEN }}
+          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The publish job already declares `permissions: contents: write`, which
is the scope GitHub's runner-supplied `GITHUB_TOKEN` needs to create
Releases — no additional permission changes required.

**Deprecations removed.** None.

**Behavior changes without code changes.** Repos that adopt the new
template (or apply the diff above) start seeing GitHub Release entries
appear under the repo's `/releases` page after each publish. The
Release body is the output of:

```sh
git log <prev-tag>..<this-tag> --format='- %s' --no-merges
```

Tags suffixed with `-rc`, `-beta`, or `-alpha` are flagged
`prerelease: true`. Release creation is best-effort: a 4xx/5xx from
the GitHub API surfaces as a `publish: GitHub Release creation
failed` warning but does not fail the publish run — the registry
publish and tag push remain authoritative.

**Verification.** After the next release run on a repo that adopted the
fix:

```bash
# Inspect the publish job log:
#   "publish: GitHub Release created at https://github.com/.../releases/tag/<name>-v<x.y.z>"

# Or hit the API directly:
gh release view <name>-v<x.y.z> --repo <owner>/<repo>
```

If you previously saw the warning `publish: GitHub Release creation
failed` in your publish logs, the warning should be gone and the
Releases page should populate.

### Package names with `/` no longer need an encode/decode workaround

**Summary.** Polyglot-monorepo repos that group packages by language
(e.g. `name = "py/foo"`, `"js/bar"`) used to fail at the build job
with:

```
The artifact name is not valid: py/foo-sdist.
Contains the following character: Forward slash /
```

…because `actions/upload-artifact@v4` forbids `/` in artifact names
and the planner emitted `artifact_name` verbatim from `pkg.name`
([#230](https://github.com/thekevinscott/putitoutthere/issues/230)).
The planner now encodes each `/` to `__`
(`py/foo` → `py__foo-sdist`), so the build job's
upload-artifact step works without modification — pass the matrix
`artifact_name` field through verbatim and the encoding happens
upstream.

**Required changes.**

- **None for repos with slash-free `pkg.name`** — `artifact_name`
  is byte-identical to the previous version.
- **Repos that ran the [`cachetta#26`-style](https://github.com/thekevinscott/cachetta/pull/26)
  encode/decode workaround should remove it.** The planner now
  does the encoding natively; leaving the workaround in place
  produces double-encoded names like `py____foo-sdist`, which the
  publish-side reader will treat as a missing artifact.

  ```diff
   - uses: actions/upload-artifact@v4
     with:
  -    name: ${{ format('{0}', matrix.artifact_name) }}  # any sed/format encode
  -    path: ${{ matrix.artifact_path }}
  +    name: ${{ matrix.artifact_name }}                 # use the field as-is
  +    path: ${{ matrix.artifact_path }}
  ```

  ```diff
   - uses: actions/download-artifact@v4
     with:
       path: artifacts
  - - name: Decode artifact dir names
  -   run: |
  -     # rename artifacts/py__foo-sdist back to artifacts/py/foo-sdist
  -     ...
  ```

**Deprecations removed.** None.

**Behavior changes without code changes.**

- `pkg.name` containing `__` (the new encoding sequence) is now
  rejected at config load with: `package name must not contain "__"
  (reserved: piot encodes "/" to "__" for artifact-name slots; pick
  a different separator)`. If your config uses `__` in a package
  name today, rename to use `-` or `_` and update any tags / consumer
  references; piot can't safely sanitize it without ambiguity.
- `pkg.name` containing `\`, `:`, `<`, `>`, `|`, `*`, `?`, or `"`
  is now rejected at config load. None of these are valid in npm,
  PyPI, or crates.io names, so any config that previously contained
  them was already broken at publish time — the change just moves
  the failure earlier with a clearer message.

**Verification.**

```sh
putitoutthere plan --json | jq '.[].artifact_name'
```

Expect every emitted `artifact_name` to contain only ASCII letters,
digits, `-`, `_`, and `.` — no `/` and no other forbidden chars.
For a repo with `name = "py/cachetta"`:

```
"py__cachetta-sdist"
"py__cachetta-wheel-x86_64-unknown-linux-gnu"
```

After the next release, the build job's `actions/upload-artifact@v4`
step uploads under `py__cachetta-sdist/` (a single flat directory
under `artifacts/`), and piot's publish-side reader consumes the
same path.

### Documentation accuracy pass (#231)

**Summary.** A docs-vs-code audit found several places where reference
material lagged behind shipped behavior. Existing configs and workflows
keep working — the only consumer-observable change is that `putitoutthere
--help` no longer mislabels `--json` as "plan only".

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- `putitoutthere --help` output: the `--json` line now reads `emit
  machine-readable output (most commands)` instead of `(plan only)`. The
  flag has always been accepted on every command that emits a result;
  only the help text was wrong.
- No other behavior changes. All other audit findings were addressed by
  updating documentation (`docs/api/cli.md`, `docs/api/action.md`,
  `docs/guide/configuration.md`, `docs/guide/trailer.md`, `README.md`,
  `action.yml` description text, VitePress sidebar).

**Verification.**

```sh
putitoutthere --help | grep -- '--json'
# Expected: --json            emit machine-readable output (most commands)
```

### Python shape examples now use `uv build`

**Summary.** Documentation examples for the Python library, Python
cibuildwheel, and dynamic-versions shapes switched the sdist-build
step from `python -m build --sdist` to `uv build --sdist`. piot's
contract is unchanged — backends, artifact names, the
`matrix.artifact_name` / `matrix.artifact_path` fields, and the
publish-side completeness check all work identically. The change
removes a `pip install build` round-trip and aligns the docs with
`uv` as the recommended Python toolchain.

**Required changes.** None. `python -m build` still works. To
follow the new examples in your own `release.yml`:

```diff
 build:
   ...
   steps:
-    - uses: actions/setup-python@v5
-      with: { python-version: '3.12' }
     - name: Build sdist
-      run: |
-        cd ${{ matrix.path }}
-        python -m pip install build
-        python -m build --sdist --outdir dist
+      working-directory: ${{ matrix.path }}
+      run: uv build --sdist
+    # uv installs and manages Python itself; no setup-python step needed.
+    # Add this once at the top of the build job:
+    - uses: astral-sh/setup-uv@v3
```

`uv build --sdist` writes to `dist/` inside the working directory
(same as `python -m build --outdir dist`), so
`matrix.artifact_path` keeps pointing at the right place. The
publish job is unchanged — `setup-python` + `pip install twine` is
still the recommended path there because piot's PyPI handler shells
out to `twine`.

**When *not* to follow this example.** Stay on `python -m build`
if:

- Your CI image already has Python pre-installed and adding
  `setup-uv` would slow the cold cache.
- Your `pyproject.toml` exercises a build backend feature that uv's
  isolated build environment doesn't yet handle (rare; uv's build
  isolation matches `python -m build`'s).
- Your team's runbook standardises on `python -m build` and the
  consistency cost of switching outweighs the per-run speedup.

`python -m build` is not deprecated and will keep working.

**Deprecations removed.** None.

**Behavior changes without code changes.** None.

**Verification.**

```bash
# After the build job runs:
ls artifacts/<pkg.name>-sdist/
# Expected: <pypi-name>-X.Y.Z.tar.gz   (no .devN suffix)
```

If you see the expected sdist, the switch worked. If you see a
`.devN` suffix, your project uses dynamic versioning — see
[dynamic versions](https://thekevinscott.github.io/putitoutthere/guide/dynamic-versions)
for the env-var handoff (unchanged by this migration).

### Repository renamed `put-it-out-there` → `putitoutthere`

**Summary.** The GitHub repository slug collapsed from `put-it-out-there`
to `putitoutthere`, matching the npm package and CLI binary name. The
human-readable name "Put It Out There" (with spaces) is unchanged. GitHub
auto-redirects the old URL, but any place a consumer has hard-coded the
old slug — npm/Cargo/pyproject `repository` URLs, GitHub Actions
references, OIDC trust policy `repository:` claims, docs links — should
be updated.

**Required changes.**

```diff
 # package.json (or Cargo.toml / pyproject.toml)
-"repository": "https://github.com/<owner>/put-it-out-there"
+"repository": "https://github.com/<owner>/putitoutthere"
```

```diff
 # .github/workflows/release.yml — if you reference the action by full repo path
-uses: thekevinscott/put-it-out-there/.github/actions/<...>
+uses: thekevinscott/putitoutthere/.github/actions/<...>
```

```diff
 # OIDC trust policies (PyPI, npm) that gate on the source repo
-"repository": "<owner>/put-it-out-there"
+"repository": "<owner>/putitoutthere"
```

If you only ever invoked `putitoutthere` via the npm package
(`npx putitoutthere`, `pnpm add -D putitoutthere`) or the published
GitHub Action, no change is required — those references already used the
collapsed name.

**Deprecations removed.** None. The old slug continues to redirect at
the GitHub layer.

**Behavior changes without code changes.**

- Documentation site moved from
  `https://thekevinscott.github.io/put-it-out-there/` to
  `https://thekevinscott.github.io/putitoutthere/`. The old URL
  redirects.
- `git remote -v` will still show the old URL until you `git remote
  set-url origin https://github.com/thekevinscott/putitoutthere.git`.
  Push and fetch keep working via redirect, but updating the remote
  avoids surprise breakage if the redirect is ever retired.

**Verification.**

```sh
# Confirm no stale references in your repo
grep -r "put-it-out-there" .
```

Expect no hits outside historical changelog/migration entries.

### `[package.bundle_cli]` — stage a Rust CLI into every maturin wheel (#217)

**Summary.** New optional sub-table under `[[package]]` for pypi packages
that want the `ruff` / `uv` / `pydantic-core` wheel shape: a companion
Rust CLI binary, cross-compiled per target and staged into the Python
source tree before maturin runs, so each wheel ships the binary as
package data and `pip install <pkg>` gets a working CLI on `PATH` with
no Rust toolchain on the user's machine. Additive — existing
configurations are unchanged.

**Required changes.** None for existing configs. To opt in:

```diff
 [[package]]
 name       = "my-py"
 kind       = "pypi"
 build      = "maturin"
 path       = "packages/python"
 globs      = ["packages/python/**"]
 targets    = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]
+
+[package.bundle_cli]
+bin        = "my-cli"
+stage_to   = "src/my_py/_binary"
+crate_path = "crates/my-rust"   # defaults to "." (repo workspace root)
```

And in the Python package's `pyproject.toml`:

```diff
+[project.scripts]
+my-cli = "my_py._binary:entrypoint"    # small os.execv launcher stub
+
 [tool.maturin]
-include = ["..."]
+include = ["...", "src/my_py/_binary/**"]  # ship the staged binary
```

See [README → Rust CLI inside a PyPI wheel](https://github.com/thekevinscott/putitoutthere/blob/main/README.md#rust-cli-inside-a-pypi-wheel)
for the full worked example including the launcher stub.

**Deprecations removed.** None.

**Behavior changes without code changes.** None for existing configs.
Packages that declare `[package.bundle_cli]` get two new steps emitted
in the scaffolded build job (`Setup Rust (if pypi bundle_cli)` +
`Build + stage bundled CLI`), both gated on
`matrix.kind == 'pypi' && matrix.bundle_cli.bin != '' && matrix.target != 'sdist'`
so packages without the block see no change.

**Verification.** For a repo that opts in:

```bash
# After piot's build job runs on one target:
ls packages/python/src/my_py/_binary/
# Expected: my-cli  (or my-cli.exe on Windows targets)

# After the wheel is built:
python -m zipfile -l packages/python/dist/*.whl | grep _binary
# Expected: one entry per target listing the staged binary.

# End-to-end on a released wheel:
pip install my-py==<published-version>
which my-cli
my-cli --version
```
