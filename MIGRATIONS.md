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

### Pre-merge crate-size check

**Summary.** `putitoutthere check` gained a check that runs
`cargo package --no-verify` for every `kind = "crates"` package and
fails when the resulting `.crate` is larger than crates.io's 10 MiB
(`10485760`-byte) upload limit. Previously an oversized crate — most
often caused by a tracked symlink dragging a build tree into the
package — surfaced only mid-release as a `413 Payload Too Large` from
`cargo publish`, after the verification build. The new check moves
that failure to PR time, before merge.

**Required changes.** None. The check is additive and runs
automatically wherever `putitoutthere check` already runs (the
`check.yml` reusable workflow). For the check to actually measure a
crate, a Rust toolchain (`cargo`) must be on `PATH` in that job; when
`cargo` is absent the check degrades to a no-op rather than failing,
so a check job without Rust set up sees no behavior change.

**Deprecations removed.** None.

**Behavior changes without code changes.** A PR that would produce an
oversized `.crate` now fails `putitoutthere check` with the new
`PIOT_CRATES_PACKAGE_TOO_LARGE` error code, instead of passing the
check and failing later inside the release run's publish job.

**Verification.** Add a `kind = "crates"` package and run
`putitoutthere check` (or open a PR against a repo wired to
`check.yml`) in an environment with `cargo` on `PATH`: an oversized
crate reports `PIOT_CRATES_PACKAGE_TOO_LARGE` naming the `.crate`
size and the 10 MiB limit, while a normally-sized crate reports
nothing.

### v0 tracks main HEAD

**Summary.** Until this release, the floating `v0` tag advanced only
when a `release:` trailer fired the dogfood publish pipeline
(`release-npm.yml`), which then moved `v0` to the latest
`putitoutthere-v0.x.y` release commit. Commits that landed on main
without a trailer — test-only changes, docs edits, dependency bumps,
internal refactors, and one-off bug fixes whose author forgot the
trailer — left `v0` stale relative to main. The behavior was
explicitly chosen in issue #199 (`v0` = "latest released commit in
major line") and is now explicitly reversed: `v0` tracks main HEAD,
not the latest release.

A new workflow `.github/workflows/advance-v0.yml` fires on every
push to main, builds the action bundle, folds it into a tag-only
commit (mirroring `release-npm.yml`'s existing Fold step —
`dist-action/` is gitignored on main, so `v0` must point at a
synthesized bundle commit for `uses:
thekevinscott/putitoutthere@v0` to resolve to a runnable action),
and force-moves `v0` to that commit. The new workflow shares the
`release` concurrency group with `release-npm.yml`, so when both
fire on the same push (a trailer-bearing commit), the registry
publish runs first and `v0` is then advanced on top.

The permanent per-release tags (`putitoutthere-v0.x.y`) are
unchanged — they're cut by the dogfood publish pipeline on
trailer-fire and remain the canonical version history.

**Required changes.** None on the consumer side. The change is in
how `@v0` resolves over time, not in what the workflow at that ref
does.

**Deprecations removed.** None.

**Behavior changes without code changes.** A commit that lands on
`main` of `thekevinscott/putitoutthere` is, on the next consumer
workflow resolve, the workflow code the consumer runs. Previously
consumers had to wait for a release to be cut to pick up engine
changes; now they pick them up on the next push to main. Consumers
who want pinning to a known-released version use a
`putitoutthere-v0.x.y` tag (or a SHA) instead of `@v0`.

**Verification.** After this change merges and the first push to
main fires `advance-v0.yml`, the `v0` tag points at a fresh bundle
commit whose parent is the merge commit on main. Confirm with:

```
$ git ls-remote --tags https://github.com/thekevinscott/putitoutthere.git v0
<sha>  refs/tags/v0
$ git log <sha> -1 --format='%H %s'
<sha> chore(v0): bundle action
$ git log <sha>^ -1 --format='%H %s'   # parent is the merge commit on main
<parent-sha> <merge commit subject>
```

### Preflight: manifest repository URL must match GITHUB_REPOSITORY; private repos rejected

**Summary.** Two new preflight checks address the
"surprise-at-publish" failure mode where a manifest's declared
`repository` URL silently disagrees with the GitHub repository the
workflow is actually running from. npm's provenance verification
returns a 422 (`"package.json: repository.url is X, expected to
match Y from provenance"`) **after** the artifact has been uploaded
and the registry has done OIDC negotiation — the kind of mid-publish
surprise this engine's "no release surprises" design commitment
exists to prevent. The same risk lives on the crates.io / PyPI
trusted-publisher paths against `Cargo.toml [package].repository`
and `pyproject.toml [project.urls]`. Both checks now fire at the
preflight stage before any side effects.

A second new check refuses to publish from a **private** GitHub
repository entirely. Provenance attestations embed a public
source-ref pointer that consumers cannot dereference when the repo
is private; the same source-visibility expectation underpins the
trusted-publisher story across all three registries. Hard-failing
at preflight beats silently shipping a verification-broken artifact.

**Required changes.** None for any consumer whose manifest URLs
already point at the correct `owner/repo` on GitHub and whose
repository is public. The check is opt-out only by fixing the
underlying disagreement.

| Failure mode                                                          | Fix                                                                                                                                                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PIOT_REPO_URL_MISMATCH` on a renamed repo, manifests stale.          | Update the manifest URL to match the GitHub repo (recommended), or rename the GitHub repo so the slugs line up. Re-run the release.                                                                                |
| `PIOT_REPO_URL_MISMATCH` on a manifest that points at a fork or mirror. | Point the manifest URL at the canonical GitHub repo the workflow runs from. Trusted-publisher records on every registry bind to the workflow source, not the fork.                                                 |
| `PIOT_REPO_PRIVATE` on a repository that is intentionally private.    | This engine cannot publish from a private repository. Either flip the repo to public before releasing or use a different release path. There is no opt-out flag — provenance attestations require public source.   |

**Deprecations removed.** None.

**Behavior changes without code changes.** None — both checks are
new gates.

**Verification.** From a PR branch with a deliberately-wrong
`repository.url`, the PR-time `check.yml` job now reports
`[PIOT_REPO_URL_MISMATCH]` naming both the declared and expected
`owner/repo` slugs and the manifest path. From a private repo,
`publish` aborts before any side effect with `[PIOT_REPO_PRIVATE]`.
Both checks no-op outside a GHA context (when `GITHUB_REPOSITORY`
is unset), so a local `putitoutthere check` from a developer
machine does not false-positive.

### Windows default runner pinned to windows-2022

**Summary.** GitHub is migrating `windows-latest` (and `windows-2025`)
to Visual Studio 2026 between 2026-06-08 and 2026-06-15 — see the
[GitHub Actions image-migration changelog](https://github.blog/changelog/2026-05-14-github-actions-upcoming-image-migrations/)
and [actions/runner-images#14016](https://github.com/actions/runner-images/issues/14016).
Until that date, `windows-latest` is Windows Server 2025 + VS2022; on
the cutover, `windows-latest` redirects to `windows-2025-vs2026` and
every consumer release run lands on a fresh toolchain with no
opportunity to verify it first.

`defaultRunsOn` in `src/plan.ts` previously returned `windows-latest`
for any Windows-shaped triple, so every consumer release plan that
included `x86_64-pc-windows-msvc` (the standard windows triple for
napi, bundled-cli, and maturin builds) inherited that floating label.
The default is now `windows-2022`: stable, VS2022, no surprise
migration. Consumers who want to track the floating label or adopt
VS2026 early opt in via the per-target `{ triple, runner }` override
that already exists.

**Required changes.** None for consumers who want to stay on a stable
VS2022 toolchain — the new default does that for them. Consumers who
want a different image opt in per target:

Before (relied on the floating `windows-latest` default):

```toml
[[package]]
name    = "lib-napi"
kind    = "npm"
build   = "napi"
targets = [
  "x86_64-unknown-linux-gnu",
  "x86_64-pc-windows-msvc",
]
```

After (no change required — `x86_64-pc-windows-msvc` now resolves to
`windows-2022` by default):

```toml
[[package]]
name    = "lib-napi"
kind    = "npm"
build   = "napi"
targets = [
  "x86_64-unknown-linux-gnu",
  "x86_64-pc-windows-msvc",
]
```

After (opt in to a different image — for example, surface VS2026
breakage now rather than on the cutover date):

```toml
targets = [
  "x86_64-unknown-linux-gnu",
  { triple = "x86_64-pc-windows-msvc", runner = "windows-2025-vs2026" },
]
```

Other valid choices for the `runner` value include `windows-2025`
(Server 2025 + VS2022 until the cutover, then VS2026), `windows-2022`
(matches the new default explicitly), and `windows-latest` (preserves
the previous floating-label behavior).

**Deprecations removed.** None.

**Behavior changes without code changes.** Every Windows-shaped
matrix row's `runs_on` field now resolves to `windows-2022` instead
of `windows-latest` when no per-target `runner` override is set.
Per-target overrides win exactly as before — the bare-string-vs-object
precedence in `defaultRunsOn` is unchanged. The redirect notice
GitHub injects into every `windows-latest`-targeted run
(`NOTICE: windows-latest requests are being redirected to
windows-2025-vs2026 by June 15, 2026`) stops appearing on plans
generated by the new engine.

**Verification.** Run a release that includes any Windows triple and
confirm the build job runs on `windows-2022`:

- In the GitHub Actions UI, the per-target build job's "Set up job"
  step lists `Runner: GitHub Actions <n>` followed by an OS-image
  block whose `Image: windows-2022` line names the pinned image. The
  banner `windows-latest requests are being redirected to
  windows-2025-vs2026 by June 15, 2026` no longer appears in the
  job log.
- The published artifact's `runs_on` value, surfaced in the plan
  step's job summary, is `windows-2022`.

To opt in to a different image, set
`{ triple = "x86_64-pc-windows-msvc", runner = "<choice>" }` on the
relevant target and re-release; the build job moves to the named
image on the next run.

### Crates first-publish TP rejection detected

**Summary.** crates.io's Trusted Publishing feature binds to an
already-published crate name. The very first publish of a brand-new
crate cannot use the TP path — the OIDC mint succeeds, the exchanged
token reaches cargo, but the registry rejects the publish with a 404
("crate `<name>` does not exist or you do not have permission to
publish to it"). The engine previously surfaced this as a generic
`cargo publish failed` block, sending consumers down a credentials
rabbit-hole when the real fix is one bootstrap publish via the
classic-token fallback shipped in #283.

The crates handler now detects this exact response shape and throws
with the new stable error code
`PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED`, prefixed onto a message
that names the crate, explains the TP-binds-to-published-crate
constraint, and points at `CARGO_REGISTRY_TOKEN` as the bootstrap
path. Cargo's full stderr is preserved at the bottom of the error
for debuggability. Companion work landed a registry-auth response
fixtures catalogue at
[`notes/upstream-behaviors.md`](./notes/upstream-behaviors.md) that
indexes this and three other response shapes the engine handles or
architecturally avoids — see #296.

**Required changes.** None. Consumers who never hit the
first-publish path see no change. Consumers whose first release
fails on a brand-new crate now see a clearer error pointing at the
fix; the fix itself (set `CARGO_REGISTRY_TOKEN` as a workflow
secret for one publish, then remove it) has been available since
#283 and is unchanged.

**Deprecations removed.** None.

**Behavior changes without code changes.** A `cargo publish`
failure whose stderr matches the first-publish-TP-rejection shape
now throws with `PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED` instead of
the generic `cargo publish failed` shape. The full cargo stderr
remains in the error message. The detector is suppressed under the
`PIOT_CRATES_REGISTRY_PRIMARY` e2e seam (alt-registry doesn't model
TP, so a 404 there is a different bug).

**Verification.** On a brand-new crate name where Trusted
Publishing is the only auth configured, run the release. The
release run fails with a message starting
`[PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED] cargo publish: crates.io
rejected publishing "<name>" because the crate has never been
published.` followed by the bootstrap hint. Set
`CARGO_REGISTRY_TOKEN` in the workflow's `secrets:` block (per
#283), re-run, and the publish should succeed. Subsequent releases
can drop the secret and rely on Trusted Publishing.

### Bundled-CLI launcher generated by the workflow

**Summary.** Bundled-CLI npm consumers used to author `bin/<bin>.js` —
a Node launcher that detects the host platform, maps it to a triple,
resolves the corresponding `<name>-<triple>` (or templated) platform
package, and execs the binary. The launcher's only per-consumer
inputs are the package name and the configured `targets` list. Both
are in the engine's hands at plan time. Every consumer's launcher
was byte-identical modulo those two values.

`_matrix.yml`'s build job now invokes a new internal `putitoutthere
write-launcher` CLI subcommand on the main row of each `kind = "npm"
&& build = "bundled-cli"` package (before `npm run build --if-present`
runs). The subcommand writes `bin/<bundle_cli.bin>.js` and adds the
matching `package.json#bin` entry in place. Both writes are guarded
by an "only if absent" check — existing consumer-authored launchers
and existing `bin` fields are preserved, so the override path is the
same file you'd already have committed.

The generated launcher's shape mirrors the README example bundled-cli
consumers wrote by hand pre-#299: hashbang, a Node
`${platform}-${arch}` → triple table, `require.resolve` against the
platform package, `spawnSync` with `stdio: 'inherit'`. The platform
package's name template (`{name}-{triple}` by default, or whatever the
consumer set under `build = [{ mode = "bundled-cli", name = "..." }]`
in the multi-mode array form) has every placeholder except `{triple}`
resolved at generation time; `{triple}` becomes a backtick template
substitution at install time. The launcher imports nothing from
putitoutthere at runtime — it's a self-contained Node script with no
published-package dependencies.

Together with #298 (which absorbed the cross-compile build script),
bundled-cli npm's consumer surface is now: declare the package in
`putitoutthere.toml`, register Trusted Publishers, push.

**Required changes.** None for new consumers — declaring the package
in `putitoutthere.toml` is sufficient.

For consumers who already shipped a hand-authored launcher and want
to migrate to the generated one, delete `bin/<bin>.js` from the source
tree. The build job will regenerate it on the next release run.
Leaving the file in place is fully supported; the workflow only
writes when the file is absent.

```diff
  // packages/my-cli/package.json
  {
    "name": "my-cli",
-   "bin": { "my-cli": "bin/my-cli.js" }
  }
```

Removing the `bin` field is optional too: when the workflow sees an
existing `bin` field it leaves it alone. The diff above is only
necessary if the consumer wants the workflow to author the field
shape from scratch (`{ "<bin>": "bin/<bin>.js" }`).

**Deprecations removed.** None — the legacy hand-authored launcher
path is still supported and the workflow respects the override.

**Behavior changes without code changes.**

- The published main package's `package.json#bin` now contains
  `{ "<bundle_cli.bin>": "bin/<bundle_cli.bin>.js" }` for consumers
  who previously had no `bin` field. Consumers with a pre-existing
  `bin` field see no change.
- The published main package's tarball now contains
  `bin/<bundle_cli.bin>.js` for consumers who previously did not
  commit the file. Consumers who committed the file see their version
  shipped unchanged.

**Verification.** After a release run, inspect the published main
package's tarball:

```sh
npm pack <main-pkg-name>@<version>
tar -xvf <main-pkg-name>-<version>.tgz package/bin/<bundle_cli.bin>.js -O \
  | head -20
```

The first line is `#!/usr/bin/env node`; the file declares a `triples`
object whose keys match the Node `${platform}-${arch}` strings the
package's `targets` resolve to, and whose values are the configured
triples. `package/package.json`'s `bin` field is
`{ "<bundle_cli.bin>": "bin/<bundle_cli.bin>.js" }`.

### `bundle_cli` wheel guard respects `python-source`

**Summary.** Maturin's standard mixed-project layout
(`maturin new --mixed` generates `[tool.maturin].python-source = "python"`)
declares a package source root that maturin strips from on-disk paths
when rewriting them into the wheel's distribution layout. A binary
staged on disk at `<pkg.path>/<stage_to>/<bin>` — e.g.
`packages/python/python/dirsql/_binary/dirsql` — ends up in the wheel
at `dirsql/_binary/dirsql`, with `python/` stripped. The reusable
workflow's `bundle_cli` wheel-content guard previously asserted a
literal `<stage_to>/<bin>` suffix inside the produced wheel; the regex
never matched the stripped path, so the guard fired red on every
per-target build row even when the binary was correctly bundled.

The guard now reads `[tool.maturin].python-source` (and the legacy
`python_source` spelling — both forms are accepted by maturin across
versions) from `<matrix.path>/pyproject.toml` and subtracts that
prefix from `stage_to` before constructing the suffix regex. Consumers
with an implicit-root layout (no `python-source` key, or an empty
value) keep the previous behavior byte-for-byte; consumers with the
explicit-root layout start passing the guard. Tracked at #338.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- For a consumer with `[tool.maturin].python-source = "python"` and
  `[package.bundle_cli].stage_to = "python/dirsql/_binary"`, the
  reusable workflow's wheel-content guard now resolves the in-wheel
  suffix to `dirsql/_binary/<bin>` (matching what maturin actually
  produces) instead of asserting the unstripped `python/dirsql/_binary/<bin>`.
- A `python-source` value that isn't actually a prefix of `stage_to`
  is left alone — the guard reverts to asserting the unstripped
  `stage_to` so the consumer's misconfiguration surfaces with the same
  diagnostic it does today.
- An unset or empty `python-source` value resolves to the empty
  string and `stage_suffix` is unchanged. No behavior change for
  consumers who don't use the explicit-root layout.

**Verification.** With a maturin package whose `pyproject.toml`
declares `[tool.maturin].python-source = "python"` and whose
`[package.bundle_cli]` sets `stage_to = "python/<pkg>/_binary"`,
a release run should produce wheels whose `unzip -l` listing contains
`<pkg>/_binary/<bin>` and the wheel-content guard step should log
`ok bundle_cli: <pkg>/_binary/<bin> present in <wheel>`.

### `bundle_cli` cargo workspace

**Summary.** Two collided bugs made `[package.bundle_cli]`
unsatisfiable for the standard cargo-workspace layout: a single
workspace root `Cargo.toml` with `[workspace] members = [...]` and the
`[[bin]]` declared in a member crate (the shape `cargo new --workspace`
produces, and what the polyglot Rust/Python recipe in the README
implies). With `crate_path = "."` (the default), `putitoutthere check`
parsed the workspace root `Cargo.toml` literally, saw no `[[bin]]`, and
emitted `bundle_cli.bin "X" is not declared as a [[bin]]`. With
`crate_path = "packages/rust"`, the check passed but the reusable
workflow's bundle_cli stage step couldn't find the produced binary —
cargo writes to the workspace-rooted target dir by default
(`<repo-root>/target/...`), not to the working-directory-rooted one
(`packages/rust/target/...`) the stage step assumed. There was no
`crate_path` value that satisfied both halves.

The check now walks `[workspace].members` and aggregates each member's
declared bins (honoring the implicit-binary rule, including
`[package].name = { workspace = true }` inheritance from
`[workspace.package].name`). The reusable workflow's cargo build step
pins `--target-dir target` so the produced binary is deterministically
at `${{ matrix.bundle_cli.crate_path }}/target/<triple>/release/<bin>`
regardless of whether the crate participates in a workspace. Tracked at
#337.

**Required changes.** None.

Consumers whose `[package.bundle_cli]` block already worked (single-
crate layouts, or workspaces where `crate_path` pointed directly at the
member crate and the consumer's project structure happened to make the
workspace target dir line up with the member target dir) keep building
byte-identically. Consumers whose workspace layout previously failed
the check or stage step start working without touching their config.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- `putitoutthere check` accepts the cargo-workspace shape:
  ```toml
  # /Cargo.toml
  [workspace]
  members = ["packages/rust"]

  # /packages/rust/Cargo.toml
  [package]
  name = "my-cli"
  description = "..."
  license = "MIT"

  [[bin]]
  name = "my-cli"
  path = "src/main.rs"

  # /putitoutthere.toml
  [package.bundle_cli]
  bin      = "my-cli"
  stage_to = "python/dirsql/_binary"
  # crate_path defaults to "."
  ```
  previously reported `bundle_cli.bin "my-cli" is not declared as a [[bin]]`,
  now reports zero findings.
- The reusable workflow's bundle_cli build step now passes
  `--target-dir target` to `cargo build`. The produced binary is at
  `${{ matrix.bundle_cli.crate_path }}/target/<triple>/release/<bin>`
  regardless of workspace membership, and the stage step's `src=` path
  resolves correctly by construction.
- Members declared as glob patterns (`members = ["crates/*"]`) are not
  expanded by the check; if your bin lives behind a glob, declare the
  literal member path. `cargo build` itself handles globs at build time
  and is unaffected.

**Verification.** With the workspace layout above, the consumer should
see:

- `putitoutthere check` reports zero findings.
- A maturin release run produces a wheel whose `unzip -l` includes the
  staged binary (the existing wheel-content guard asserts this).

### Crates metadata check resolves `[workspace.package]` inheritance

**Summary.** Cargo's recommended pattern for shared crate metadata in a
workspace is `[workspace.package]` in the workspace root combined with
`<field>.workspace = true` on each member. `cargo publish` resolves the
inheritance and embeds the literal value into `Cargo.toml.orig` before
upload, so crates.io receives the resolved field. The pre-merge
`check` and the pre-publish `requireCratesMetadata` previously parsed
each member `Cargo.toml` in isolation and treated the
`{ workspace: true }` placeholder as a missing string, flagging
well-formed workspaces with `PIOT_CRATES_MISSING_METADATA` even though
the eventual `cargo publish` would succeed. The check now walks up from
each crate's `path` to find the nearest parent `Cargo.toml` carrying a
`[workspace]` table and, when a member field is declared as
`<field>.workspace = true`, resolves the value from `[workspace.package]`
before deciding it's missing. Genuinely-missing inherited fields — the
workspace root has no value for the key, or no `[workspace.package]`
block at all — still report through `PIOT_CRATES_MISSING_METADATA`. Hit
in the wild in `thekevinscott/dirsql#177`. Tracked at #328.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- Crates packages whose `Cargo.toml` reads
  ```toml
  [package]
  name = "foo"
  description.workspace = true
  license.workspace = true
  ```
  with the workspace root supplying
  ```toml
  [workspace.package]
  description = "..."
  license = "MIT"
  ```
  no longer surface as `PIOT_CRATES_MISSING_METADATA` findings from
  `putitoutthere check` or as `requireCratesMetadata` errors from the
  publish path. `license-file.workspace = true` resolves the same way.
- Crates that inherit a field whose workspace root omits it (or has no
  `[workspace.package]` block) continue to surface as
  `PIOT_CRATES_MISSING_METADATA` — the publish would still fail at
  crates.io's metadata gate, so the preflight keeps flagging it.
- Inline (non-inherited) `description` / `license` / `license-file`
  fields are unchanged.

**Verification.** Inside a workspace that centralizes metadata:

```toml
# Cargo.toml
[workspace]
members = ["packages/rust"]

[workspace.package]
license = "MIT"
description = "Shared description."

# packages/rust/Cargo.toml
[package]
name = "foo"
description.workspace = true
license.workspace = true
```

`putitoutthere check` should report `0 findings` for `foo`'s metadata,
and `cargo metadata --no-deps --format-version=1 --manifest-path packages/rust/Cargo.toml`
should show the resolved `"license":"MIT"` / `"description":"..."`.

### Hatch wheel-any row

**Summary.** `kind = "pypi"` + `build = "hatch"` now publishes a wheel
alongside the sdist. Previously the matrix carried only a
`target = "sdist"` row, so PyPI ended up with sdist-only and downstream
`pip install` / `uvx ...` had to provision hatchling and run
`python -m build` on a cold cache — several seconds per invocation
instead of a sub-second download-and-extract. `pypa/build`'s default on
a pure-Python tree produces both an sdist and an any-platform wheel; the
planner just wasn't asking for the wheel. Issue #324.

The matrix now emits a second row per hatch package:

| Field           | Value                                |
|-----------------|--------------------------------------|
| `target`        | `any`                                |
| `artifact_name` | `<package-name>-wheel-any`           |
| `artifact_path` | `<package-path>/dist`                |
| `runs_on`       | `ubuntu-latest`                      |
| `build`         | `hatch`                              |

The reusable workflow's build step gates on
`matrix.kind == 'pypi' && matrix.build == 'hatch' && matrix.target == 'any'`
and runs `python -m build --wheel --outdir dist` (with
`SETUPTOOLS_SCM_PRETEND_VERSION` set, mirroring the sdist row's contract).

**Required changes.** None. The recommended consumer-side recipe in
[README → Quickstart](./README.md#1-drop-in-githubworkflowsreleaseyml)
already uses `actions/download-artifact@v8` with
`pattern: '*-wheel-*'` and `pattern: '*-sdist'` and feeds the combined
`dist/` to `pypa/gh-action-pypi-publish@release/v1`. Both patterns now
match for hatch packages without any consumer-side YAML change.

If you have a hand-rolled `pypi-publish` job that consumes specific
artifact names, add `<package-name>-wheel-any` to its download list.

**Deprecations removed.** None.

**Behavior changes without code changes.** Hatch packages whose previous
release shipped sdist-only will, on the first release after upgrading,
also publish an any-platform wheel to PyPI under the same version. No
new tag is created and no extra publish-time orchestration is needed —
the wheel is uploaded alongside the sdist in the existing
`pypa/gh-action-pypi-publish` step.

Scope is `build = "hatch"` only. `build = "setuptools"` stays
sdist-only and `build = "maturin"` keeps its per-target wheel rows
(both unchanged).

**Verification.** After publishing a hatch package:

```
curl -s https://pypi.org/pypi/<name>/json | jq '.urls[].packagetype'
# "sdist"
# "bdist_wheel"   ← previously absent
```

`pip install <name>` (or `uvx <name>`) should download `*.whl` and
skip the local build step entirely.

---

### pypi `pyproject.toml` must declare `dynamic = ["version"]`

**Summary.** Every `kind = "pypi"` package's `pyproject.toml` must
now declare `[project].dynamic = ["version"]`. Static
`[project].version = "x.y.z"` literals are rejected at PR time by
`putitoutthere check` and again at publish-time preflight, both
under the stable error code `PIOT_PYPI_STATIC_VERSION`. This is
the most common Python-publishing footgun: putitoutthere does not
edit `pyproject.toml` at release time (per the [no version
computation](./notes/design-commitments.md#non-goals) design
commitment), so a literal silently shipped the previous release's
wheel/sdist because the build backend read whatever was on disk.
Making the dynamic shape mandatory closes the failure mode at the
earliest knowable boundary — the consumer's own repo state, before
a release run is ever invoked.

**Required changes.**

Before — a static literal, accepted in v0.2.x:

```toml
[project]
name = "your-package"
version = "0.1.0"
```

After — `hatch-vcs` (recommended for new packages):

```toml
[build-system]
requires = ["hatchling", "hatch-vcs"]
build-backend = "hatchling.build"

[project]
name = "your-package"
dynamic = ["version"]

[tool.hatch.version]
source = "vcs"
```

After — `setuptools-scm` (for setuptools-backed projects):

```toml
[build-system]
requires = ["setuptools>=64", "setuptools-scm>=8"]
build-backend = "setuptools.build_meta"

[project]
name = "your-package"
dynamic = ["version"]

[tool.setuptools_scm]
```

After — `maturin` (Python packages built from a Rust crate): the
version source moves to the sibling `Cargo.toml`'s
`[package].version`. `pyproject.toml` declares only that the version
is dynamic:

```toml
[build-system]
requires = ["maturin>=1"]
build-backend = "maturin"

[project]
name = "your-package"
dynamic = ["version"]
```

No reusable-workflow input changes; the existing
`SETUPTOOLS_SCM_PRETEND_VERSION` injection in the build step already
hands the planned version to `hatch-vcs` / `setuptools-scm`, and the
existing `putitoutthere write-version` step already bumps
`Cargo.toml` for the maturin path.

**Deprecations removed.**

- `pypi.writeVersion` and the `putitoutthere write-version` CLI
  subcommand no longer rewrite static literals in place — both now
  surface `PIOT_PYPI_STATIC_VERSION`. Previously they would
  silently overwrite the literal.
- The `replacePyProjectVersion` helper export and the
  "bumps BOTH pyproject and sibling Cargo.toml on the static-literal
  path" #276 carve-out are gone. Under the dynamic contract, `Cargo.toml`
  alone is the bump target on the maturin path and the pyproject literal
  has no role.

**Behavior changes without code changes.**

- `putitoutthere check` reports `PIOT_PYPI_STATIC_VERSION` against
  every pypi package whose `pyproject.toml` has a literal
  `[project].version`. Aggregated with the other preflight
  findings — one round-trip, not one error at a time.
- The publish path runs `requirePypiVersionSource` between the
  existing `requireCratesMetadata` and the artifact-completeness
  check; a misconfigured pypi tree fails fast there even if the
  PR-time `check.yml` gate was skipped.

**Verification.**

```bash
# In a repo that still declares a static version:
$ putitoutthere check
[PIOT_PYPI_STATIC_VERSION] packages/python/pyproject.toml declares a
static `[project].version` literal. Use `[project].dynamic =
["version"]` ...

# After the migration above:
$ putitoutthere check
# (no findings, exits 0)
```

Tracked at #333.

---

### `npm` `bundle_cli` absorbed into the reusable workflow

**Summary.** `kind = "npm"` packages with `build = "bundled-cli"`
no longer need to author a `scripts/build.cjs` that performs the
Rust cross-compile by hand. Declare `[package.bundle_cli]` in
`putitoutthere.toml` — same schema as the pypi/maturin block from
#282, minus `stage_to` (npm staging is determined entirely by the
matrix row's `artifact_path`) — and the reusable workflow runs
`rustup target add`, `cargo build --release --target <triple>
--bin <bin>` against `crate_path`, and the copy-into-staging step
itself. A defense-in-depth build-content guard asserts the staged
binary exists before `actions/upload-artifact` runs, so a broken
row never leaves the build runner. Mirror of the pypi wiring landed
in #282; closes the seam that #287 patched (env-var contract
between the consumer's build script and the engine).

**Required changes.** None for additive adoption. To migrate an
existing consumer with a hand-written `scripts/build.cjs`:

Before (`putitoutthere.toml`):

```toml
[[package]]
name    = "my-cli"
kind    = "npm"
build   = "bundled-cli"
path    = "packages/ts-cli"
globs   = ["packages/ts-cli/**", "crates/my-cli/**"]
targets = [
  "x86_64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  # ...
]
```

`scripts/build.cjs` (consumer-owned):

```js
const { execFileSync } = require('node:child_process');
const { mkdirSync, copyFileSync } = require('node:fs');
const target = process.env.TARGET;
if (!target || target === 'main' || target === 'noarch') process.exit(0);
const binName = 'my-cli';
const ext = target.includes('windows') ? '.exe' : '';
execFileSync('rustup', ['target', 'add', target], { stdio: 'inherit' });
execFileSync('cargo', ['build', '--release', '--target', target, '--bin', binName],
  { cwd: '../../crates/my-cli', stdio: 'inherit' });
mkdirSync(`build/${target}`, { recursive: true });
copyFileSync(`../../crates/my-cli/target/${target}/release/${binName}${ext}`,
  `build/${target}/${binName}${ext}`);
```

`package.json` (consumer-owned):

```json
{ "scripts": { "build": "tsc && node scripts/build.cjs" } }
```

After (`putitoutthere.toml`):

```toml
[[package]]
name    = "my-cli"
kind    = "npm"
build   = "bundled-cli"
path    = "packages/ts-cli"
globs   = ["packages/ts-cli/**", "crates/my-cli/**"]
targets = [
  "x86_64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  # ...
]

[package.bundle_cli]
bin        = "my-cli"
crate_path = "crates/my-cli"
# features            = ["cli"]     # if the binary is feature-gated
# no_default_features = false
```

`scripts/build.cjs`: **deleted.** The `build` script in
`package.json` typically becomes `"tsc"` (or whatever your
TypeScript launcher build was minus the `node scripts/build.cjs`
half).

**During migration both shapes coexist.** A consumer that still
ships `scripts/build.cjs` keeps working — the workflow's cargo
build runs first, then `npm run build --if-present` runs the
consumer's script (which sees `build/<triple>/` already populated
and probably no-ops). There's no transitional broken state and
no flag to set.

**Constraint.** The binary must build with a vanilla
`cargo build --release --target <triple> --bin <bin>` from
`crate_path`. Optional `features` / `no_default_features` cover
the `[[bin]] required-features = ["cli"]` shape. Crates that need
arbitrary env vars, alternate manifests, Zig-cc cross
toolchains, or other cargo flags don't fit the recipe and
should keep their own release workflow.

**Deprecations removed.** None.

**Behavior changes without code changes.** Existing consumers
without `[package.bundle_cli]` declared are unaffected — the
workflow's cargo build / stage / guard steps are gated on
`matrix.bundle_cli` being set, so consumers who still rely on
their hand-written `scripts/build.cjs` see the byte-identical
build matrix they saw before. The schema rejects `bundle_cli`
declared on a non-bundled-cli npm package (or with empty
`targets`), so a typo can't make the block silently inert.

**Verification.** After upgrading, switch one consumer's
`putitoutthere.toml` to declare `[package.bundle_cli]` and
remove the `node scripts/build.cjs` half of their `build` script.
The next release run's build job will, for each per-target row,
include three new step lines: `bundle_cli — add Rust target`,
`bundle_cli — cargo build for <triple> (<bin>)`, and
`bundle_cli — stage binary into <artifact_path>`, followed by
the `bundle_cli — verify <artifact_path>/<bin>` guard before
`Upload artifact`. The published per-platform tarball, when
downloaded and unpacked, contains the cross-compiled binary at
the same path the launcher resolves it from.

---

### Preflight pyproject + cargo shape

**Summary.** Preflight gains two more checks — `requirePyprojectShape`
and `requireCargoShape` — that mirror the #280 / #290 pattern for
`pyproject.toml` (pypi packages) and `Cargo.toml` (crates packages,
plus `bundle_cli` on pypi packages). The maturin / setuptools /
hatchling / cargo CLIs surface mismatched-shape errors 10-20 minutes
into a release run, deep into the verification build, with messages
that don't name the precondition that failed. The new checks fire at
publish time alongside the existing `require*` family and at PR time
via `check.yml`. Findings aggregate across every failing package so
consumers fix them all in one round-trip, exactly the shape the prior
checks established. #301.

**Required changes.** None for well-formed manifests. Repos that
declared one of the documented mismatches below previously got a
mid-release red; they now get a fast preflight red instead.

The new error codes:

| Code | Fires when |
|------|------------|
| `PIOT_PYPI_NAME_MISMATCH` | `pyproject.toml`'s `[project].name` differs from `[[package]].name` (or the `pypi` override). |
| `PIOT_PYPI_BUILD_BACKEND_MISMATCH` | `[build-system].build-backend` is set and does not start with the prefix the configured `build` mode expects (`maturin` → `maturin`, `setuptools` → `setuptools`, `hatch` → `hatchling`/`hatch`). |
| `PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND` | `[project].dynamic` includes `"version"` but neither `[tool.hatch.version]` nor `[tool.setuptools_scm]` is present. |
| `PIOT_PYPI_MATURIN_INCLUDE_MISSING` | `bundle_cli` is set but `[tool.maturin].include` does not cover `bundle_cli.stage_to`. |
| `PIOT_CRATES_NAME_MISMATCH` | `Cargo.toml`'s `[package].name` differs from `[[package]].name` (or the `crate` override). |
| `PIOT_CRATES_MISSING_BIN` | `bundle_cli.bin` is set but the target `Cargo.toml` has no `[[bin]]` table with that name (and the implicit-bin name derived from `[package].name` does not match either). |
| `PIOT_CRATES_FEATURE_NOT_DECLARED` | `features` (on `kind = "crates"` packages) or `bundle_cli.features` references a feature not declared in `[features]`. |
| `PIOT_CRATES_WORKSPACE_VERSION_MISMATCH` | `[package].version.workspace = true` but no ancestor `Cargo.toml` declares `[workspace.package].version`. |

**Deprecations removed.** None.

**Behavior changes without code changes.** Repos with one of the
shapes above used to get a confusing mid-release error from
maturin / setuptools / hatchling / cargo (sometimes after a
verification build of every transitive dep); they now get a
fingerprintable `PIOT_*` error at preflight time, before any side
effects. PR-time `check.yml` runs surface the same findings on
every pull request, so the typical case is fix-before-merge rather
than fix-after-release-red. The `[build-system].build-backend`
check is deliberately narrow: a missing `[build-system]` table is
allowed (pip falls back to setuptools), and the prefix match
tolerates backend-version drift across maturin / setuptools /
hatchling.

**Verification.** Misconfigure one field, run `pnpm putitoutthere
check` (or open a PR with `check.yml` wired), see the relevant
`PIOT_*` code surface in seconds instead of mid-release.

### New `check.yml` reusable workflow for PR-time config sanity

**Summary.** `putitoutthere` now ships a third reusable workflow,
`.github/workflows/check.yml`, that drives the engine's `check`
subcommand at PR time. The subcommand aggregates every pre-merge
check (`putitoutthere.toml` parse + schema, common-mistakes
detector, unique-name guard, `depends_on` cycle / dangling-ref
detection, `[[package]].path` existence, `globs` matching a
tracked file, `tag_format` collisions, npm `repository` field,
crates `description` / `license`, pypi `pyproject.toml` +
`bundle_cli` binary declaration, npm target triple mapping)
and reports findings in one round-trip. Where `release.yml` is
the release-time phase and `build.yml` is the heavier per-target
build gate, `check.yml` is the cheap config-sanity gate — a few
seconds per PR, no `setup-python` / `setup-rust`, no per-target
compile. Shipped per the "no release surprises" goal added in
#316: anything checkable from the consumer's repo state alone
surfaces at PR time, not at release time. Issue #317 (workflow
shell) + issue #319 (check list, shipped via #321).

**Required changes.** Additive. Existing consumers do nothing.
Recommended: add a one-line PR-CI workflow.

```yaml
# .github/workflows/check.yml  ←  new file in your repo, optional
name: putitoutthere check

on:
  pull_request: {}

jobs:
  putitoutthere-check:
    uses: thekevinscott/putitoutthere/.github/workflows/check.yml@v0
```

The new workflow accepts no `with:` inputs, no `secrets:`, no
`permissions:` requirements beyond the default `contents: read` it
sets internally. The integration line is the entire surface.

**Deprecations removed.** None.

**Behavior changes without code changes.** None. Existing release
runs are unaffected — the new workflow is opt-in PR-time CI; the
release path is unchanged.

**Verification.** Open a PR that introduces a typo in
`putitoutthere.toml` (e.g. `[[packages]]` instead of `[[package]]`).
Without `check.yml` wired, the failure surfaces at release time
in a red `plan` step. With `check.yml` wired, the PR fails red at
review time with the same diagnosable error message, before the
merge.

### Internal cargo-http-registry alt-registry for crates e2e

**Summary.** Internal change with no consumer-observable impact. Adds
[`cargo-http-registry`](https://github.com/d-e-s-o/cargo-http-registry)
— an off-the-shelf, auth-free cargo alt-registry, the lone
"Verdaccio for cargo" the survey of the cargo-registry ecosystem
turned up — to `e2e-fixture-job.yml`'s publish job, installed via
`cargo install --locked` and started as a background process on
every crates-bearing matrix row. Two internal engine seams in
`src/handlers/crates.ts` consume it: `PIOT_CRATES_REGISTRY_FALLBACK`
retries `cargo publish` against the alt-registry on a 429-rate-limit
shape from real crates.io ("You have published too many versions of
this crate in the last 24 hours") and emits a `::warning::` workflow
command so reviewers see the fallback engaged. A symmetric
`PIOT_CRATES_REGISTRY_PRIMARY` seam routes the publish *only* at the
override URL (no real-crates.io attempt, no fallback); reserved for
any future `*-first-publish` crates fixture. A first attempt on
this issue wired Kellnr; three CI rounds all 403'd because every
*production* cargo alt-registry (Kellnr / alexandrie / ktra /
cratery) is multi-tenant-shaped and deliberately rejects
fixture-style unrecognized identities. The cargo ecosystem has no
analog of npm's per-user self-registration convention, so picking
the one off-the-shelf "no-auth" registry is the only path that
works without auth gymnastics. The reusable consumer workflow
(`release.yml`), `putitoutthere.toml` schema, trailer grammar, the
dogfood `release-rust.yml`, and consumer-facing docs are
untouched. #331.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** None for consumers. For
contributors running e2e locally: the publish job in
`e2e-fixture-job.yml` now `cargo install`s
`cargo-http-registry@0.1.8` on crates-bearing rows (~70s cold; the
crate has a lightweight dep tree — tokio rt-only + warp + git2, no
openssl-sys / sqlite-sys / aws-lc-sys) and starts it as a
background process bound at `127.0.0.1:35503`. Cargo's
`net.git-fetch-with-cli = true` is written to `~/.cargo/config.toml`
on the same path because libgit2 enforces strict `application/x-git-*`
content-type checking that `cargo-http-registry` doesn't satisfy;
the system `git` binary is more lenient and works fine. The handler
in `src/handlers/crates.ts` now passes `--token <placeholder>`
alongside `--index <url>` on alt-registry invocations because
cargo's CLI refuses to dispatch publish without an explicit
`--token` once `--index` is set — a CLI quirk; the value is never
validated by `cargo-http-registry`. Steady-state crates fixtures
keep their real-crates.io OIDC-TP path unchanged on the happy path;
the fallback only fires when real crates.io returns a 429.

**Verification.** A successful CI run on a PR that hits the
crates.io 24h-per-crate quota (the polyglot fixture's
`piot-fixture-zzz-poly-rust` row) goes green via the alt-registry
fallback with a `::warning::` in the run log naming the fallback URL,
instead of failing red on the 429. When the quota is fresh, the
`e2e (polyglot-everything)` row continues to publish to real
crates.io and the warning does not fire — visible diagnostic
distinction between the two paths. The diagnostic dump step at the
end of every crates-bearing publish job emits the
cargo-http-registry process log, the readiness-endpoint probe, and
the rendered cargo `config.toml` so any future failure has the wire
trace inline in the run log.

### Internal Verdaccio e2e coverage

**Summary.** Internal change with no consumer-observable impact. Adds a
`js-vanilla-first-publish` fixture and matrix row that publishes to an
in-job Verdaccio service container; the post-publish tarball-verify step
is now registry-agnostic. `PIOT_NPM_REGISTRY` is an internal e2e seam
(`src/handlers/npm.ts`, `src/handlers/npm-platform.ts`) that routes the
publish at the override registry and suppresses provenance + the
public-npm bootstrap-hint path. The reusable consumer workflow
(`release.yml`), `putitoutthere.toml` schema, and trailer grammar are
untouched. #304 (parent #293).

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** None for consumers. For
contributors running e2e locally: the publish job in
`e2e-fixture-job.yml` now spins up a Verdaccio service container per
job (~3s startup cost). First-publish fixtures route publish at
`http://localhost:4873`; steady-state fixtures keep their real-npm
path unchanged.

**Verification.** A successful CI run on `main` shows the new
`e2e (js-vanilla-first-publish)` matrix row green. The existing
`e2e (js-vanilla)` row remains green, confirming the real-npm
steady-state hasn't regressed. To demonstrate the #256 tarball-verify
contract, trigger `E2E` via `workflow_dispatch` with
`simulate_no_dist: true` — the `js-vanilla-first-publish` row should
go red on `tarball missing 'dist'`.

### Single-artifact publish layout normalization

**Summary.** The reusable workflow's publish job downloads build
artifacts with `actions/download-artifact@v8` configured as `path:
artifacts` and no `name`/`pattern` filter. That action is
count-sensitive: multiple artifacts land in `artifacts/<name>/...`
subdirs (the documented multi-case the engine's completeness check
and every handler are written against), but a *single* artifact
extracts directly into `artifacts/` with no per-artifact subdir.
Consumers whose plan emits exactly one expected artifact — pure-Python
packages with `build = "hatch"` (sdist row only) being the canonical
case — therefore failed at the completeness check with `missing
artifact directory <pkg>-sdist/` before the pypi handler ever ran.
Multi-artifact consumers (pypi+npm, sdist+wheels, polyglot) were
unaffected. The publish job now normalizes the layout in-process
before completeness: when the plan expects one staged artifact and
`artifacts/<artifact_name>/` is absent, files in `artifacts/` are
moved into that subdir so the engine's contract holds. Fully a
fix-in-place; no input shape, output shape, or config key changed.
Tracked in #311.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- Pypi-only consumers with `build = "hatch"` (or any other
  `[[package]]` whose plan emits a single artifact row) that
  previously failed publish with `Artifact completeness check
  failed: ... missing artifact directory <pkg>-sdist/` now reach the
  pypi handler successfully and tag as expected. The wider release
  flow — version-rewrite, tag creation, GitHub Release, caller-side
  `pypi-publish` upload — was already correct; only the engine's
  pre-publish completeness check was upstream of the bug.
- Multi-artifact plans (≥2 staged artifacts), crates-only plans, and
  vanilla-npm plans (`[[package]] kind = "npm"` with no `build` /
  `build = []`) see no observable difference. The normalization is
  scoped to the exact case `download-artifact@v8` dumps into the
  root.

**Verification.** A release-please / release-plz cascade against a
pure-Python `[[package]]` with `build = "hatch"` should:

1. Surface the planned matrix as a single row,
   `target = sdist artifact = <pkg>-sdist`.
2. Reach the `pypi: <pkg>@<version> delegated to caller-side upload
   step.` log line in the publish job.
3. Push a `<pkg>-v<version>` tag, kick off the caller's
   `pypi-publish` job, and produce a GitHub Release. No
   `missing artifact directory` error appears in the run log.

### `[package.bundle_cli]` features and `no_default_features`

**Summary.** `[package.bundle_cli]` previously only worked for crates
whose CLI binary built with a vanilla `cargo build --release --target
<triple> --bin <bin>` — no feature flags, no env. The standard shape
for libraries that ship an optional CLI (ruff, uv, pydantic-core,
biome, swc, dirsql) is `[[bin]] required-features = ["cli"]`, so the
binary's deps don't pollute `cargo add <name>`. Without a way to pass
`--features`, `cargo build --bin <bin>` exits with `target ... requires
the features: cli` and the recipe was inert for the consumers it was
designed for. The schema now exposes:

- `features: list[string]` — forwarded to `cargo build --features
  <comma-list>` when non-empty. Defaults to `[]`.
- `no_default_features: bool` — adds `--no-default-features` when
  true. Defaults to `false`.

Both keys are optional; the schema defaults preserve byte-identical
cargo invocations for existing `[package.bundle_cli]` blocks. Empty
strings inside the `features` list are rejected at config load. The
caveat under [`bundle_cli` now actually stages the binary](#packagebundle_cli-now-actually-stages-the-binary)
that named this gap as "not currently supported" has been corrected.
Tracked in #300.

**Required changes.** None for consumers whose binary builds without
feature flags. Consumers whose `Cargo.toml` declares `required-features
= ["cli"]` (or who otherwise need a non-default feature set on the CLI
binary) add the new keys:

```diff
 [package.bundle_cli]
 bin        = "my-cli"
 stage_to   = "src/my_py/_binary"
 crate_path = "crates/my-rust"
+features            = ["cli"]
+no_default_features = false
```

**Deprecations removed.** None.

**Behavior changes without code changes.** None. The new keys default
to the equivalent of "no extra cargo flags," matching pre-#300
behavior.

**Verification.** Trigger a release on a maturin pypi package whose
crate uses `[[bin]] required-features = ["cli"]` and that now declares
`features = ["cli"]` in its `[package.bundle_cli]` block. The
`bundle_cli — cargo build for <triple> (<bin>)` step in the build job's
log emits `cargo build --release --target <triple> --bin <bin>
--features cli` and exits zero; the wheel-content guard step that
follows confirms `<stage_to>/<bin>` is present in the produced `.whl`.

---

### Crates Cargo.toml must declare `description` and `license`

**Summary.** Every cascaded `kind = "crates"` package's `Cargo.toml`
must now declare `[package].description` and either `[package].license`
or `[package].license-file`. The new preflight check
(`requireCratesMetadata` in `src/preflight.ts`) runs in
`src/publish.ts` immediately after `requireProvenanceMetadata` and
rejects the run with `PIOT_CRATES_MISSING_METADATA` before any
runner work. Why: crates.io rejects publish with `400 Bad Request:
missing or empty metadata fields: ...` after `cargo publish`'s
verification build has compiled the crate and every transitive dep
— wasting the entire publish job (often a minute+ of compile time
plus the upload) on a precondition checkable in milliseconds. Hit
in the wild on `thekevinscott/darkfactory`'s first crate publish;
tracked in #290. Same shape as #280 (npm `repository`).

**Required changes.** Add the two fields to every Cargo.toml
declared as `kind = "crates"` in `putitoutthere.toml`.

| Before                                                                                  | After                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[package]`<br>`name = "lib"`<br>`version = "0.1.0"`<br>`edition = "2021"`              | `[package]`<br>`name = "lib"`<br>`version = "0.1.0"`<br>`edition = "2021"`<br>`description = "One-line summary."`<br>`license = "MIT OR Apache-2.0"`                                   |

`license-file = "LICENSE"` is accepted as a substitute for
`license` (the SPDX expression form). Whitespace-only values
(`description = "   "`) are treated as empty.

No `release.yml` or `putitoutthere.toml` changes are required.

**Deprecations removed.** None.

**Behavior changes without code changes.** `putitoutthere publish`
now fails fast at preflight with
`[PIOT_CRATES_MISSING_METADATA] cargo publish requires the
following Cargo.toml [package] fields: description, and license
(or license-file).` for any cascaded crates package whose
Cargo.toml lacks the fields. Previously the same shape ran
through plan + auth-negotiation + ~30s of cargo verification
build and failed inside `cargo publish` with a 400 from
crates.io. Well-formed packages are unaffected.

The error message names every failing package, its `Cargo.toml`
path, and the specific missing fields, so consumers fix all of
them in one round-trip rather than discovering them one at a
time across multiple release attempts.

**Verification.** Drop `description` from one of your Cargo.toml
files locally and run `pnpm test:integration` (or the engine
against a local fixture); the failure should arrive at preflight
with `PIOT_CRATES_MISSING_METADATA` in the message, no crate
should be published, and no git tag should be created. Restore
the field; the next run completes normally.

---

### npm build step: TARGET / BUILD env vars

**Summary.** The reusable workflow's `_matrix.yml` and `release.yml`
now set `TARGET=${{ matrix.target }}` and `BUILD=${{ matrix.build }}`
on the `matrix.kind == 'npm'` build step (and `TARGET=main BUILD=`
on `release.yml`'s publish-job rebuild loop, which only ever runs
for the main package's row). Bundled-CLI / napi consumers' build
scripts read these env vars to know which triple to cross-compile
and which build mode is active; without them, every per-platform
matrix row produced an empty `build/<triple>/` directory and
`actions/upload-artifact@v7` reported
`No files were found with the provided path: ...`. The internal
`e2e-fixture-job.yml` already passed `TARGET` / `BUILD` for the
`js-bundled-cli` fixture, so the fixture suite was green while the
shape it advertised was broken for real consumers. Tracked at #287;
hit in the wild on `thekevinscott/darkfactory`'s first release.

The README's [Bundled-CLI npm family](./README.md#bundled-cli-npm-family)
recipe gained the consumer-side build-script contract that was
previously missing: a documented `scripts/build.cjs` template
that reads `TARGET`, runs `rustup target add` + `cargo build`
+ stage-into-`build/<triple>/`, and no-ops on
`TARGET=main`. Without that section, consumers had to read the
`js-bundled-cli` test fixture or experiment to discover the
contract.

**Required changes.** None for consumers whose existing build
script either ignored `TARGET` or used a different env var name —
those scripts now get the `TARGET` / `BUILD` exports too but
nothing forces them to read. To start using the contract, mirror
the README's `scripts/build.cjs` shape and reference it from
`package.json`'s `scripts.build` field. Existing fixtures and
the engine's contract are unchanged.

**Deprecations removed.** None.

**Behavior changes without code changes.** The npm build step
now runs with `TARGET` and `BUILD` set in its environment.
Build scripts that previously saw `undefined` and either crashed
or silently no-oped will now see a defined string. Vanilla npm
consumers (no `build = "bundled-cli" | "napi"`) see
`TARGET=main BUILD=` (or `BUILD=undefined` on rows that don't
declare a build mode); their build scripts that don't read either
var are unaffected.

**Verification.** A bundled-cli consumer following the README
recipe sees their per-platform matrix rows produce non-empty
artifacts: each `<pkg>-npm-<triple>` upload contains
`build/<triple>/<bin-name>`. The release run's `Upload artifact`
step no longer logs `No files were found with the provided path`
for any npm row.
### First-publish bundled-cli lockfile self-heal

**Summary.** The reusable workflow's npm install steps —
`_matrix.yml`'s build-matrix install and `release.yml`'s
publish-job rebuild (#256) — both ran strict installs (`npm ci`
or `pnpm install --frozen-lockfile`) and refused on any drift
between the committed lockfile and `package.json`. For consumers
of the bundled-cli / napi shape, drift is the *expected* state on
the first publish: `package.json` declares
`optionalDependencies` for `<name>-<triple>@<version>` platform
packages that this pipeline produces, those packages don't exist
on the registry yet, pnpm 10 silently drops 404'd optionals from
the lockfile when it is regenerated locally, and the next CI run
sees lockfile and `package.json` disagree. Hit in the wild on
`thekevinscott/darkfactory`'s first release.

Both install steps now fall back from the strict form to its
non-strict counterpart on failure (`pnpm install --no-frozen-lockfile`
/ `npm install`) and emit a `::warning::` line in the run log
naming the recovery. The README's
[Bundled-CLI npm family](./README.md#bundled-cli-npm-family)
recipe grew a `[!NOTE]` callout documenting the chicken-and-egg
and the workflow's transparent recovery.

**Required changes.** None. Consumers who were working around
the failure by gitignoring the lockfile, by suppressing
`optionalDependencies` from `package.json`, or by pinning to
older lockfile-tolerant pnpm versions can revert those
workarounds; the workflow now handles the bootstrap state on
its own.

**Deprecations removed.** None.

**Behavior changes without code changes.** Strict installs that
previously failed red on lockfile drift now succeed via the
non-strict fallback path. The build artifact is unchanged
(installs the deps `package.json` declares); only the strictness
of *how* it gets there relaxes. Healthy lockfiles still take
the strict path with no observable difference. The new
`::warning::` lines are visible in the run log on the GitHub
Actions UI but do not fail the run.

**Verification.** A bundled-cli / napi consumer's first-publish
release run completes the build matrix without manual lockfile
fiddling. The run log contains a single
`::warning::pnpm-lock.yaml drift ...` line per affected install
step (one in the build matrix, one in the publish-job rebuild)
when the strict install fails; healthy installs see no
warning.

### Platform-publish `.npmrc` lookup

**Summary.** The reusable workflow's per-triple platform-package
publishes (`build = "bundled-cli"` / `build = "napi"`) ran `npm
publish` from a temporary staging directory rather than from the
consumer's package path. npm reads `.npmrc` from cwd upward; the
consumer's `.npmrc` lives at `pkg.path`, never on the path to a
tempdir, so platform publishes never saw the auth the main package
relied on. OIDC trusted publishing masked the gap (auth flows via
the `ACTIONS_ID_TOKEN_REQUEST_TOKEN` environment variable, not
`.npmrc`), but the `NPM_TOKEN` bootstrap path (#310) — required
for the very first publish of a brand-new npm package — and the
internal Verdaccio e2e seam (#304) both broke because both rely on
`.npmrc`-supplied auth.

The engine now invokes `npm publish <stagingDir>` with `cwd:
pkg.path`, matching how the main-package publish already runs.
npm reads the consumer's `.npmrc` (including any `_authToken`,
`always-auth`, or scoped-registry entries) and applies it to the
PUT for each per-triple platform package.

**Required changes.** None. The fix is internal to
`src/handlers/npm-platform.ts`; consumer `release.yml` flows are
unchanged.

**Deprecations removed.** None.

**Behavior changes without code changes.** Consumers who rely on
`NPM_TOKEN` (rather than OIDC) for the first publish of a
bundled-cli / napi family — i.e. a brand-new npm package whose
per-triple sub-packages also don't exist yet — now succeed without
the workaround of publishing a `0.0.0-bootstrap` stub by hand.
OIDC consumers see no observable difference: the same env-derived
auth keeps flowing because `npm publish` reads
`NODE_AUTH_TOKEN`/`ACTIONS_ID_TOKEN_REQUEST_TOKEN` from the
environment regardless of which directory cwd points at.

**Verification.** A consumer publishing a brand-new bundled-cli /
napi family via `NPM_TOKEN` completes per-triple sub-package
publishes alongside the main package on the first release run,
with no `npm publish (platform) failed` errors in the log.

### `[package.bundle_cli]` now actually stages the binary

**Summary.** Wheels published from a maturin pypi package that
declared `[package.bundle_cli]` previously shipped without the
bundled CLI binary. The block was parsed by config, attached to
per-target wheel rows by the planner, and documented in the README
and MIGRATIONS — but the reusable workflow's build job
(`.github/workflows/_matrix.yml`) had no step that consumed the
metadata. Consumers' wheels arrived on PyPI missing the file the
launcher in `[project.scripts]` resolved at runtime, and
`pip install <pkg> && <pkg> ...` failed with `FileNotFoundError`.
The recipe was advertised as shipped in v0.2.0 (#217) but was
silently a no-op for over a release cycle. Hit in the wild on
`thekevinscott/dirsql`; tracked in #282.

The workflow now runs four new steps for every per-target wheel
row where `matrix.bundle_cli` is set:

1. `rustup target add ${{ matrix.target }}` — make the triple known.
2. `cargo build --release --target ${{ matrix.target }} --bin ${{ matrix.bundle_cli.bin }}`
   against `crate_path` — produce the binary on the native host
   runner (`defaultRunsOn` in `src/plan.ts` already maps every
   supported triple to a native runner, so cross-compile linkers
   are not needed).
3. Copy the resulting binary (with `.exe` suffix on Windows) into
   `${{ matrix.path }}/${{ matrix.bundle_cli.stage_to }}/` so
   maturin's `[tool.maturin].include` glob picks it up as wheel
   data.
4. After `PyO3/maturin-action@v1` produces the `.whl`, open the
   wheel and refuse `upload-artifact` if it does not contain a
   file at any directory ending in `<stage_to>/<bin>`. This guard
   stays useful after the staging steps land — it catches any
   future regression where the cross-compile silently routes the
   binary to the wrong path, and it ensures broken wheels never
   leave the build runner.

**Required changes.** None for consumers whose existing
`[package.bundle_cli]` block follows the documented shape — the
recipe simply starts working. Consumers who relied on the broken
state (e.g., shipped a workaround that hardcoded a copy of the
binary into the source tree before `putitoutthere` ran) can
remove the workaround.

**Constraint not previously documented.** The cross-compile
assumes the binary is buildable with a vanilla
`cargo build --release --bin <bin>` — no env vars, no special
build config. Crates that gate the CLI behind a Cargo feature
(e.g., `--features cli`) are now supported via
`[package.bundle_cli].features` and
`[package.bundle_cli].no_default_features`; see
[`bundle_cli` features and `no_default_features`](#packagebundle_cli-features-and-no_default_features).

**Deprecations removed.** None.

**Behavior changes without code changes.** Existing
`[package.bundle_cli]` blocks change behavior at upgrade time:
the next release run produces wheels that contain the binary
(previously the workflow silently published wheels without it).
If a consumer's `[tool.maturin].include` path resolves to nothing
(typo, mismatched layout), the new wheel-content guard fails the
build red instead of silently uploading an unusable wheel.

**Verification.** After upgrading, trigger a release on a maturin
package that declares `[package.bundle_cli]`. The build job's log
includes a `bundle_cli — verify wheel contains <stage_to>/<bin>`
step that ends with `ok bundle_cli: <stage_to>/<bin> present in
<wheel-name>.whl`. The published wheel, when downloaded and
unzipped, contains the binary at the expected path.
`pip install <pkg> && <pkg> --version` runs the launcher and the
launcher resolves the binary inside the wheel.

---

### Friendly config error hints

**Summary.** A consumer integration produced a `putitoutthere.toml`
with four shape mistakes at once: `version = 1` declared at the
file root rather than under `[putitoutthere]`, `[[packages]]`
(plural) instead of `[[package]]` (singular), `registry =` instead
of `kind =`, and `files =` instead of `globs =`. The engine's
zod-derived error message named none of those four typos by their
correct equivalent — `Invalid input: expected object, received
undefined; ...; Unrecognized keys: "version", "packages"` is
technically correct and operationally useless. `parseConfig` now
runs a pre-pass that detects each of these four cases by inspecting
the parsed TOML before zod runs, and emits a hint that names both
the wrong key and the right one. The README's [Drop in
`putitoutthere.toml`](./README.md#2-drop-in-putitoutthere-toml)
section grew a wrong→right table covering the same four traps so
the docs and the engine speak the same vocabulary, the
[Drop in `.github/workflows/release.yml`](./README.md#1-drop-in-githubworkflowsreleaseyml)
section grew an `[!IMPORTANT]` callout warning consumers off
`push: branches: [main]` triggers on lane CI workflows, and `1b.
build-check.yml` was promoted from "Optional" to "Recommended"
because it's the cheapest pre-merge surface that exercises
`parseConfig` on the consumer's actual config.

**Required changes.** None. The hints fire only on configs that
were already failing validation; valid configs are unaffected.
A config that was failing with a confusing zod message before will
now fail with a hint message that names the fix:

| Wrong (still rejected, clearer message)                              | Right                                            |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| `version = 1` at file root, no `[putitoutthere]` table               | `[putitoutthere]` table with `version = 1` inside |
| `[[packages]]` (plural)                                              | `[[package]]` (singular, one block per package)  |
| `registry = "crates"`                                                | `kind = "crates"`                                |
| `files = ["src/**"]`                                                 | `globs = ["src/**"]`                             |

Consumers with healthy configs can ignore this. Consumers with
broken configs whose CI was previously red against a zod message
will see the same red CI with a clearer message — fix the config
shape per the table above.

**Deprecations removed.** None.

**Behavior changes without code changes.** Error message text
on failed config validation. The exit code, the failure surface
(`parseConfig` throwing inside the engine), and the set of
configs that pass validation are all unchanged.

**Verification.** A failing config with any of the four mistakes
above will now contain the words `did you mean` in its CI log
output. Repos with valid configs see no change in any release
or build-check run.

---

### npm token fallback

**Summary.** The reusable workflow now accepts an optional
`NPM_TOKEN` via `secrets:`. Trusted Publishing on npm binds to
an *already-published* package, so the very first publish of a
brand-new npm package has no OIDC path available; without this
fallback every first-time bundled-cli / napi consumer hit a 6+
package manual `0.0.0-bootstrap` stub bootstrap, documented
nowhere, only discoverable by reading commit history of dirsql
or by hitting the failure. OIDC trusted publishers remain the
default and recommended path — when the secret is unset,
behavior is byte-for-byte unchanged. When the secret is set
AND the planned matrix contains an npm row, the secret is
exported to `$GITHUB_ENV` as `NODE_AUTH_TOKEN`; the npm CLI
then prefers the long-lived token over the OIDC path. Mirror
of #283 (crates) in shape, byte-for-byte. Hit in the wild on
the maintainer's own dirsql project (first version of
`@dirsql/cli-linux-x64-gnu` on npm is `0.0.0-bootstrap`,
2026-04-30; real `0.2.8` lands the next day) and on
`darkfactory`'s first publish. #302.

**Required changes.** None for consumers already on the OIDC
path. To bootstrap a brand-new npm package or to use the
workflow on an account where Trusted Publishing isn't
available, wire the secret in the caller's `release.yml`:

| Before                                                                                 | After                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0`                   | `uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0`<br>`secrets:`<br>`  NPM_TOKEN: ${{ secrets.NPM_TOKEN }}`                                         |

The repo-level secret holding the npm automation token can be
named anything; the *workflow* secret it gets passed as must be
`NPM_TOKEN` exactly — the reusable workflow keys on that name.
Drop the `secrets:` block from the caller's `release.yml` once
Trusted Publishing is registered against the (now-existing)
package; subsequent publishes are zero-secret. For bundled-cli
/ napi families each per-platform sub-package needs its own
Trusted Publisher registration after the first publish — the
secret-bypass is a one-time bootstrap, not a permanent path.

**Deprecations removed.** None.

**Behavior changes without code changes.** None when the secret
is unset (OIDC path unchanged). When the secret is set, a new
"Export NODE_AUTH_TOKEN (caller-provided)" step writes
`NODE_AUTH_TOKEN` to `$GITHUB_ENV` gated on the secret being
non-empty AND the planned matrix containing an npm row. The
gate reads the secret through a job-level `CALLER_NPM_TOKEN`
env var because GitHub Actions does not allow the `secrets`
context inside step-level `if:` conditions ([context
availability](https://docs.github.com/en/actions/learn-github-actions/contexts#context-availability));
this is an internal mechanism — consumers don't see or set
`CALLER_NPM_TOKEN` themselves. Unlike #283 (crates), there is
no separate OIDC step to "skip" — the npm CLI handles OIDC
internally via the runner's id-token, and the presence of
`NODE_AUTH_TOKEN` in the env is what switches the CLI's auth
mode.

**Verification.** Wire `NPM_TOKEN` to a valid npm automation
token in the caller repo and trigger a release of a brand-new
package. The publish-job logs should show "Export
NODE_AUTH_TOKEN (caller-provided)" as `success`; `npm publish`
authenticates with the long-lived token rather than via OIDC,
and every per-platform sub-package in a bundled-cli / napi
family lands on the registry in a single run. Once first
publish succeeds, register Trusted Publishers against each
package URL, drop the `secrets:` block, and re-run a release
— the OIDC path covers the steady state from there.

Verified end-to-end against existing seeded fixtures and a
real first-publish on a canary repo. The Verdaccio
first-publish fixture coverage for the same path is tracked
separately at #293; until that lands this fallback is verified
by composition (mirror of #283) plus consumer-side observation
on real first publishes rather than by an automated
fresh-state fixture in this repo's CI.

---

### Crates token fallback

**Summary.** The reusable workflow now accepts an optional
`CARGO_REGISTRY_TOKEN` via `secrets:`. Trusted Publishing on
crates.io binds to an *already-published* crate, so the very
first publish of a brand-new crate has no OIDC path available;
without this fallback consumers had to either fork the workflow
or publish once outside it. OIDC trusted publishers remain the
default and recommended path — when the secret is unset,
behavior is byte-for-byte unchanged. When the secret is set,
the `rust-lang/crates-io-auth-action` OIDC exchange is skipped
and the caller-provided token is exported to `$GITHUB_ENV` as
`CARGO_REGISTRY_TOKEN` for the engine's crates handler to read.
The header comment in `.github/workflows/release.yml` has been
softened to match: previously *"Long-lived registry tokens are
explicitly NOT supported via this workflow"*; now OIDC is
described as the default with the token fallback called out for
first-publish bootstrap. #283.

**Required changes.** None for consumers already on the OIDC
path. To bootstrap a brand-new crate or to use the workflow on
an account where Trusted Publishing isn't available, wire the
secret in the caller's `release.yml`:

| Before                                                                                 | After                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0`                   | `uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0`<br>`secrets:`<br>`  CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}`                                   |

The repo-level secret holding the crates.io API token can be
named anything; the *workflow* secret it gets passed as must
be `CARGO_REGISTRY_TOKEN` exactly — the reusable workflow keys
on that name. Drop the `secrets:` block from the caller's
`release.yml` once Trusted Publishing is registered against
the now-existing crate; subsequent publishes are zero-secret.

**Deprecations removed.** None.

**Behavior changes without code changes.** None when the secret
is unset (OIDC path unchanged). When the secret is set, the
publish job's "Authenticate with crates.io (OIDC)" step is
conditionally skipped and a new "Export CARGO_REGISTRY_TOKEN
(caller-provided)" step writes the secret to `$GITHUB_ENV`
gated on the same condition. The gate reads the secret through a
job-level `CALLER_CARGO_REGISTRY_TOKEN` env var because GitHub
Actions does not allow the `secrets` context inside step-level
`if:` conditions ([context availability](https://docs.github.com/en/actions/learn-github-actions/contexts#context-availability));
this is an internal mechanism — consumers don't see or set
`CALLER_CARGO_REGISTRY_TOKEN` themselves.

**Verification.** Wire `CARGO_REGISTRY_TOKEN` to a valid
crates.io API token in the caller repo and trigger a release.
The publish-job logs should show "Authenticate with crates.io
(OIDC)" as `skipped`, "Export CARGO_REGISTRY_TOKEN (OIDC)" as
`skipped`, and "Export CARGO_REGISTRY_TOKEN (caller-provided)"
as `success`. The crate publishes; the only difference visible
in the registry is the publish was authorised against the
caller-provided token rather than an OIDC-minted ephemeral one.

---

### npm package.json must declare `repository`

**Summary.** Every cascaded `kind = "npm"` package's `package.json`
must now carry a non-empty `repository` field. The new preflight
check (`requireProvenanceMetadata` in `src/preflight.ts`) runs in
`src/publish.ts` immediately after `requireAuth` and rejects the
run with `PIOT_NPM_MISSING_REPOSITORY` before any runner work.
Why: `putitoutthere` invokes `npm publish --provenance` on the OIDC
trusted-publisher path; the npm CLI hard-requires this field so the
registry can verify the artifact was built from the repo the trusted
publisher declares. A missing or empty field previously surfaced
only after the runner had spun up, OIDC had been negotiated, and
the artifact had been built — wasting a full release run on a
precondition checkable in milliseconds. Hit in the wild on
`coaxer@0.1.1`'s first npm release; tracked in #280.

The npm handler's inline backstop (`assertRepositoryField` in
`src/handlers/npm.ts`) is also tightened. Previously it used
`if (!pkg.repository)` — falsy-only — which let three real shapes
slip through: an object without `url` (`{ type: 'git' }`), an
empty object (`{}`), and a whitespace-only string (`'   '`). All
three are now rejected; the error message also carries the stable
`PIOT_NPM_MISSING_REPOSITORY` code and the path of the offending
file, matching the preflight error.

**Required changes.** Add a `repository` block to every
`package.json` declared as `kind = "npm"` in
`putitoutthere.toml`. Canonical shape:

| Before                                              | After                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "name": "@scope/lib", "version": "0.1.0" }`      | `{ "name": "@scope/lib", "version": "0.1.0", "repository": { "type": "git", "url": "git+https://github.com/<owner>/<repo>.git", "directory": "<path/to/package>" } }` |

`directory` is needed for monorepo packages so npm can locate the
source within the repo. Both the object form and the legacy single-
string form (`"repository": "git+https://github.com/<owner>/<repo>.git"`)
are accepted; only a missing field, an empty string, or an object
without a non-empty `url` fails the check.

No `release.yml` or `putitoutthere.toml` changes are required.

**Deprecations removed.** None.

**Behavior changes without code changes.** `putitoutthere publish`
now fails fast at preflight with
`[PIOT_NPM_MISSING_REPOSITORY] npm publish requires a non-empty
\`repository\` field in package.json` for any cascaded npm package
whose `package.json` lacks the field. Previously the same shape
ran through plan + build + auth-negotiation + artifact-staging
and failed inside `npm publish` with `npm publish --provenance
requires a \`repository\` field in package.json`. Well-formed
packages are unaffected.

The error message names every failing package and its
`package.json` path so consumers fix all of them in one round-trip
rather than discovering them one at a time across multiple release
attempts.

**Verification.** Drop the `repository` field from one of your
`package.json` files locally and run `pnpm test:integration` (or
the engine against a local fixture); the failure should arrive at
preflight with `PIOT_NPM_MISSING_REPOSITORY` in the message, no
platform packages should be published, and no git tag should be
created. Restore the field; the next run completes normally.

---

### pypi/maturin version bump at build

**Summary.** `pypi` packages built with `build = "maturin"` now ship
wheels at the planned version, not at whatever literal happened to be
in `pyproject.toml` on the build runner. The reusable workflow's
build matrix (`_matrix.yml`) bumps the version source on disk to
`matrix.version` immediately before each `PyO3/maturin-action@v1`
step. Two version-source shapes are supported:

- Static literal: `[project].version = "0.1.0"` in `pyproject.toml`
  is rewritten in place. This is maturin's default project shape and
  the case that was previously broken for every consumer.
- Dynamic: `pyproject.toml` declaring `[project].dynamic = ["version"]`
  with the version sourced from a sibling `Cargo.toml`'s
  `[package].version` — that's where the bump lands instead.

Why it matters: maturin reads its version source from disk at build
time and honors no env override. Other build paths bumped elsewhere
in the contract — crates and npm at publish (`writeVersion` rewrites
the manifest before `cargo publish` / `npm publish` reads it),
setuptools-scm / hatch-vcs through `SETUPTOOLS_SCM_PRETEND_VERSION`
in the build step. Maturin had no equivalent, so wheels left the
build runner pre-versioned at the consumer's stale literal. PyPI
rejected the upload with `400 File already exists` whenever that
literal had been previously registered, even when crates and npm
shipped correctly. Hit in the wild on `dirsql`'s 0.2.8 release;
issue #276.

**Required changes.** None. The bump is internal to the reusable
workflow. Consumers pinning `release.yml@v0` and `build.yml@v0`
inherit the fix on the next workflow run with no `release.yml` edits
and no `putitoutthere.toml` edits. The fix applies equally to the
static-literal and dynamic-version shapes; consumers don't need to
restructure their pyproject to opt in.

The CLI gains a new internal subcommand,
`putitoutthere write-version --path <pkg-dir> --version <v>`, that
implements the bump dispatch. `action.yml` gains a new optional
`version:` input that the reusable workflow forwards. Both surfaces
are internal seams powering `_matrix.yml`; consumers compose with
the reusable workflow, not directly with the CLI or the JS action
(see [`notes/design-commitments.md`](./notes/design-commitments.md)
non-goal #7 and #10).

**Deprecations removed.** None.

**Behavior changes without code changes.** A maturin build run
through the reusable workflow now mutates the build runner's
`pyproject.toml` (or `Cargo.toml` for dynamic-version projects) in
place, bumping the version literal to `matrix.version`. The mutation
lives only on the build runner — the consumer's source tree is
untouched. Anyone fingerprinting on the on-disk manifest version
during a build (e.g. a custom shell step running between
`uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0`
and a follow-up step that reads the manifest) will now see the
planned version where they previously saw the consumer's stale
literal. Custom build steps that grep on a specific literal version
need to grep on `matrix.version` instead.

`pyproject.toml` projects whose `[project]` table is malformed
(neither a static `version = "..."` line nor `dynamic = ["version"]`)
now fail the build matrix with a clear error. Previously the same
shape produced wheels at whatever fallback the build backend chose,
which silently disagreed with the plan.

**Verification.** Cut a release on a maturin package whose
`pyproject.toml` carries a stale literal (e.g. `version = "0.1.0"`
when the planned version is `0.2.8`). The reusable workflow's
build matrix logs a `write-version: ... → 0.2.8` line before each
maturin invocation, and the produced wheel's `METADATA: Version:`
matches the planned version:

```sh
unzip -p dist/*.whl '*.dist-info/METADATA' | grep '^Version:'
# Version: 0.2.8
```

PyPI accepts the upload — assuming the planned version itself isn't
a duplicate of a previously-registered file.

### New `build.yml` reusable workflow for PR-time build verification

**Summary.** A second consumer-facing reusable workflow,
`.github/workflows/build.yml`, runs the same plan + build matrix that
`release.yml` runs but stops there — no publish job, no
`id-token: write`, no OIDC exchange, no registry auth. Both workflows
delegate the matrix to a shared internal `_matrix.yml`, so action
pins (`actions/checkout@v6`, `PyO3/maturin-action@v1`, etc.), per-row
build steps, and runner selection cannot drift between PR-time
verification and release-time publishing. The structural guarantee —
publish-capable bytes do not exist on the build-check code path — is
what makes this safe to run on untrusted PRs; a `dry_run: true` input
on `release.yml` would have made it a runtime guarantee subject to
GHA's expression evaluation quirks and any future `if:` bug. An
`actionlint`-job grep assertion rejects any patch that adds
`id-token: write` to `build.yml` or `_matrix.yml`.

The new workflow runs at the same `@v0` floating tag as
`release.yml`, pinned the same way the engine action already is —
floating lightweight tag, no annotated-tag pitfall ([github/community
discussion #48693](https://github.com/orgs/community/discussions/48693)).
Pinning per-release annotated tags
(e.g. `putitoutthere-v0.4.2`) is unsupported for the same reason it has
always been unsupported for `release.yml`; the `@v0` form is canonical.

**Required changes.** None for existing consumers. `release.yml` is
unchanged in its public surface — same inputs, same `has_pypi`
output, same concurrency group, same publish behavior. Internally
its `plan` and `build` jobs moved into `_matrix.yml`, but that file
is internal (the leading underscore + the absence of consumer-facing
docs); pinning `release.yml@v0` keeps working byte-for-byte.

To opt into PR-time build verification, add a new workflow to your
repo:

```yaml
# .github/workflows/build-check.yml
name: Build check
on:
  pull_request: {}
jobs:
  build-check:
    uses: thekevinscott/putitoutthere/.github/workflows/build.yml@v0
```

No new permissions, no new inputs to set. `node_version` and
`python_version` accept the same defaults / overrides as
`release.yml`. PRs that break a target-specific build (a wheel that
fails on `aarch64-apple-darwin`, an npm postinstall that fails on
Windows) now surface in review.

**Deprecations removed.** None.

**Behavior changes without code changes.** `release.yml`'s internal
job graph collapsed from `plan → build → publish` to
`build (uses: _matrix.yml) → publish`. The `publish` job now reads
`needs.build.outputs.matrix` instead of `needs.plan.outputs.matrix`;
the matrix payload is unchanged. Run logs show one nested-workflow
group (`build / plan`, `build / build`) instead of two top-level
jobs; existing log scrapers that fingerprint on the job name `plan`
need to fingerprint on `build / plan` instead.

**Verification.** On a repo that adds the build-check workflow, open
a PR that touches a `[[package]].globs` glob. The PR's Checks tab
shows a `build-check / build / build` matrix run. The job has no
`id-token: write` permission (visible in the `Show all checks` tag
on the run), and there is no `publish` job in the run's job graph.
On `main`, the existing release flow is unaffected — a tag push +
GitHub Release on the next workflow run.

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
optional `name` template (e.g. `"@scope/lib-{triple}"`) that the
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
  my-cli-napi-linux-x64-gnu/         # napi family
  my-cli-bundled-cli-linux-x64-gnu/  # bundled-cli family
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
in the wild on a downstream consumer. The publish job now installs
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

If a consumer was running newer majors (e.g. one consumer hit
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
{ "name": "py/foo", "artifact_name": "py__foo-sdist", "artifact_path": "py/foo/dist" }
```

After the next release run, the `actions/upload-artifact@v4` step
uploads `py/foo/dist/` contents flat under
`artifacts/py__foo-sdist/` (no nested `packages/python/dist/`
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
- **Repos that ran a prior `/`-encoding workaround should remove it.** The planner now
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
For a repo with `name = "py/foo"`:

```
"py__foo-sdist"
"py__foo-wheel-x86_64-unknown-linux-gnu"
```

After the next release, the build job's `actions/upload-artifact@v4`
step uploads under `py__foo-sdist/` (a single flat directory
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

> **Note (#282).** The "Behavior changes without code changes"
> paragraph below claimed two scaffolded build steps would be
> emitted. Those steps were not actually present in `_matrix.yml`
> until #282 (Unreleased); for v0.2.0 through v0.2.10 the recipe
> was a no-op and wheels shipped without the binary. See the
> Unreleased entry "[package.bundle_cli] now actually stages the
> binary" above for the actual landing.

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
