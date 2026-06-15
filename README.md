# Put It Out There

A reusable GitHub Actions workflow that publishes packages to crates.io, PyPI,
and npm from one repo. OIDC-first, cascade-aware, polyglot. The consumer
surface is one config file plus one canonical YAML calling
`uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0`.

## Quickstart

### 1. Drop in `.github/workflows/release.yml`

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

  # PyPI upload runs in the caller's workflow context. Required because
  # PyPI Trusted Publishers can't validate OIDC tokens minted from a
  # cross-repo reusable workflow (pypi/warehouse#11096). The `if:`
  # gate skips this job for non-PyPI repos — paste verbatim regardless
  # of what you publish.
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

Pinned action versions, `plan → build → publish` orchestration, and GitHub
Release creation all live inside the reusable workflow. Each tag the engine
pushes gets a matching GitHub Release with notes auto-generated from PR
titles between that tag and its predecessor (`gh release create
--generate-notes`); no `gh release create` step is needed in your workflow. The `pypi-publish`
job is the one piece that has to live in your workflow file: PyPI's
Trusted Publisher feature filters OIDC tokens by `repository_owner` /
`repository_name` claims, which always reflect the caller's repo — so a
TP registered against `thekevinscott/putitoutthere` is filtered out
before `job_workflow_ref` is even checked. Running `pypa/gh-action-pypi-publish`
in your workflow context aligns the claims with your TP registration.
The job is skipped automatically for repos that don't publish to PyPI.

> [!IMPORTANT]
> **Don't run anything else on `push: branches: [main]`.** If you have
> per-language CI workflows (`rust.yml`, `node.yml`, `python.yml`,
> etc.), keep them on `pull_request:` only — drop any `push: branches: [main]`
> trigger they may carry. Branch protection plus PR-required CI already
> covered the merge commit's contents on the PR build; firing the lane
> workflows a second time on the push to `main` is duplicate work that
> contends for runners with `release.yml` and delays the release. A repo
> with three lane workflows + paths filters that all match the merge
> commit will fire four workflows where one was wanted. Fix: keep
> `release.yml` as the only `push: branches: [main]` workflow.

Optional inputs — `with:` block at the call site:

| Input            | Default      | Use when                                                                 |
|------------------|--------------|--------------------------------------------------------------------------|
| `environment`    | `release`    | Your GitHub deployment environment is named differently.                 |
| `node_version`   | `24`         | You need a specific Node version for `kind = "npm"` build steps.         |
| `python_version` | `3.12`       | Deprecated — no longer affects `kind = "pypi"` builds. Wheel coverage is inferred from `requires-python` or pinned via [`python_versions`](#kind--pypi). |

### 1b. Recommended: drop in `.github/workflows/check.yml`

Run every pre-merge config check the engine knows about on every
PR. The fastest gate against a malformed `putitoutthere.toml`, a
duplicate package name, a `depends_on` cycle, a missing
`[[package]].path` directory, globs that match no tracked files,
a `tag_format` collision, a missing `repository` field on an
`npm` package, missing `description` / `license` on a `crates`
package, a `bundle_cli` binary the crate doesn't declare, a
`pyproject.toml` whose `[project].name` or `[build-system].build-backend`
disagrees with the configured `name` / `build`, a `Cargo.toml` whose
`[package].name` disagrees with the configured `name` / `crate`, or a
`features` list referencing a feature the crate doesn't declare — a
couple of seconds per PR, no per-target build, no `setup-python`
/ `setup-rust`. Findings are aggregated into one report so you
fix everything in one push instead of chasing errors across re-
runs.

```yaml
name: putitoutthere check

on:
  pull_request: {}

jobs:
  putitoutthere-check:
    uses: thekevinscott/putitoutthere/.github/workflows/check.yml@v0
```

Green here = "a release run from this commit would not surface
configuration-level surprises." `check.yml` does not build anything,
does not run `setup-node` against your sources, and never holds a
publishable artifact in memory; its `permissions:` block is
`contents: read` only.

`check.yml` takes no inputs. The Node version is pinned internally
because no consumer build steps run on this code path — the
`node_version` knob on `build.yml` / `release.yml` does not exist
here. Wire `check.yml` exactly as shown above.

### 1c. Recommended: drop in `.github/workflows/build-check.yml`

Run the same plan + build matrix on every PR, with the publish step
structurally absent. Slower than `check.yml` (it actually compiles
every per-target wheel and binary) but catches the bugs `check.yml`
can't observe — a per-target build break, a missing `repository`
field that the build process surfaces, an `aarch64-apple-darwin`
linker incompatibility. Wire both: `check.yml` catches the cheap
mistakes in seconds, `build.yml` catches the rest before the merge.

```yaml
name: Build check

on:
  pull_request: {}

jobs:
  build-check:
    uses: thekevinscott/putitoutthere/.github/workflows/build.yml@v0
```

`build.yml` calls the same internal `_matrix.yml` reusable workflow that
`release.yml` does — same action pins, same per-target build steps, same
runners — so a PR that breaks `aarch64-apple-darwin` wheels surfaces
in review instead of at release time. The publish job, the
`id-token: write` permission, and the OIDC trusted-publisher exchanges
do not exist on this code path; there is no flag, no input, no
conditional that could ever cause it to publish. Same `node_version` /
`python_version` inputs as `release.yml`; no new config to write.

### 2. Drop in `putitoutthere.toml`

```toml
[putitoutthere]
version = 1

[[package]]
name  = "my-lib"
kind  = "pypi"        # or "npm" | "crates"
path  = "."
globs = ["src/**", "pyproject.toml"]
build = "hatch"       # required for kind = "pypi"
tag_format = "v{version}"   # single-package repos often want this
```

`globs` are the path globs that trigger a release. Any commit touching a
matching file makes the package a candidate.

> [!CAUTION]
> **Four schema gotchas, one per line.** Every one of these has tripped a
> consumer at least once; the engine throws a hint when it sees them but
> they're cheaper to avoid than to debug.
>
> | Wrong                              | Right                          |
> |------------------------------------|--------------------------------|
> | `version = 1` at file root         | `[putitoutthere]` table with `version = 1` inside |
> | `[[packages]]` (plural)            | `[[package]]` (singular, one block per package)   |
> | `registry = "crates"`              | `kind = "crates"`              |
> | `files = ["src/**"]`               | `globs = ["src/**"]`           |

More config patterns are in [Configuration](#configuration) below.

### 3. Register trusted publishers

Each registry needs a one-time external setup so OIDC publishes work. See
[Trusted publishers](#trusted-publishers) below — three short lists, one per
registry.

### 4. Push a release

Merge to `main`. Default behavior: any package whose `globs` matched changed
files cascades and ships at `patch`. To bump `minor` or `major`:

```
fix: handle empty token lists

release: minor
```

…in the merge commit body. See [Trailer](#trailer) below.

## Configuration

`putitoutthere.toml` lives at the repo root.

### `[putitoutthere]`

```toml
[putitoutthere]
version = 1   # required; only 1 is valid today
```

### `[[package]]` (one per releasable unit)

| Field           | Type     | Required | Notes                                             |
|-----------------|----------|----------|---------------------------------------------------|
| `name`          | string   | yes      | Unique across the config.                         |
| `kind`          | enum     | yes      | `crates` \| `pypi` \| `npm`.                      |
| `path`          | string   | yes      | Package working dir (`Cargo.toml` / `pyproject.toml` / `package.json` location). |
| `globs`         | string[] | yes      | Path globs that cascade this package.             |
| `depends_on`    | string[] | no       | Package names this one cascades on top of.        |
| `first_version` | string   | no       | Default `0.1.0`.                                  |
| `tag_format`    | string   | no       | Template for the git tag. Default `"{name}-v{version}"`. Single-package repos often want `"v{version}"`. |

### `kind = "crates"`

| Field                 | Type     | Notes                                                      |
|-----------------------|----------|------------------------------------------------------------|
| `crate`               | string   | Override `name` → crates.io name.                          |
| `features`            | string[] | Pass through to `cargo publish --features`.                |
| `no_default_features` | bool     | Pass `--no-default-features` to `cargo publish` when true. |

> [!IMPORTANT]
> **`Cargo.toml` MUST match the configured shape.** Preflight verifies
> these at PR time (via `check.yml`) and again before any publish side
> effect:
>
> - `[package].name` matches `[[package]].name` (or the `crate` override) —
>   `PIOT_CRATES_NAME_MISMATCH`.
> - `[package].description` and `[package].license` (or `license-file`) are
>   set — `PIOT_CRATES_MISSING_METADATA`.
> - Every entry in `features` (and in `bundle_cli.features`, when set) is
>   declared in `[features]` — `PIOT_CRATES_FEATURE_NOT_DECLARED`.
> - When `bundle_cli.bin` is set, the target `Cargo.toml` declares a
>   `[[bin]]` with that name (or the implicit binary derived from
>   `[package].name`) — `PIOT_CRATES_MISSING_BIN`.
> - When `[package].version.workspace = true`, an ancestor `Cargo.toml`
>   declares `[workspace.package].version` —
>   `PIOT_CRATES_WORKSPACE_VERSION_MISMATCH`.

### `kind = "pypi"`

| Field        | Type                   | Notes                                              |
|--------------|------------------------|----------------------------------------------------|
| `pypi`       | string                 | Override `name` → PyPI registered name.            |
| `build`      | enum                   | `maturin` \| `setuptools` \| `hatch`. Optional. Default `setuptools`. |
| `targets`    | (string \| object)[]   | Required when `build = "maturin"`. Triples or `{ triple, runner }` objects. |
| `bundle_cli` | table                  | Opt-in: cross-compile a Rust CLI per target and stage it into each wheel. Only valid with `build = "maturin"`. See [Recipes → Rust CLI inside a PyPI wheel](#rust-cli-inside-a-pypi-wheel). |
| `python_versions` | string[]          | Optional override for the CPython versions wheels are built for, e.g. `["3.12", "3.13"]`. When omitted, the set is inferred from `[project].requires-python` and putitoutthere's checked-in released-CPython list (see below). |

> [!NOTE]
> **`kind = "pypi"` builds a wheel for every supported Python version.**
> By default the version set is inferred from `[project].requires-python`
> in your `pyproject.toml` — `requires-python = ">=3.10"` builds wheels
> for every released CPython minor version in putitoutthere's checked-in
> list that it allows. No configuration is needed for the common case;
> update putitoutthere when a new CPython minor should be included.
> To pin an explicit subset, set `python_versions` on the package. The
> build matrix fans across the resolved set (per `maturin` target); the
> sdist and a pure-Python `hatch` wheel are version-agnostic and built
> once. A `maturin` wheel that is itself Python-version-independent —
> `[tool.maturin].bindings = "bin"` (a `py3-none` Rust-binary wheel) or a
> pyo3 `abi3` extension (a `cp3x-abi3` wheel) — is likewise built once, on
> the newest resolved interpreter, instead of duplicated across the set
> (the duplicates otherwise collide at the `pypi-publish` download). When
> neither `python_versions` nor a parseable `requires-python` is present, a
> single wheel is built for `3.12`.

> [!IMPORTANT]
> **`pyproject.toml` MUST match the configured shape.** Preflight verifies
> these at PR time (via `check.yml`) and again before any publish side
> effect:
>
> - `[project].name` matches `[[package]].name` (or the `pypi` override) —
>   `PIOT_PYPI_NAME_MISMATCH`.
> - `[build-system].build-backend`, when set, matches the configured
>   `build` mode (`maturin` → `maturin`, `setuptools` →
>   `setuptools.build_meta`, `hatch` → `hatchling.build`) —
>   `PIOT_PYPI_BUILD_BACKEND_MISMATCH`.
> - When `[project].dynamic` contains `"version"`, either
>   `[tool.hatch.version]` or `[tool.setuptools_scm]` declares the version
>   source — `PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND`.
> - When `bundle_cli` is set, `[tool.maturin].include` covers
>   `bundle_cli.stage_to` — `PIOT_PYPI_MATURIN_INCLUDE_MISSING`.

### `kind = "npm"`

| Field     | Type                   | Notes                                                |
|-----------|------------------------|------------------------------------------------------|
| `npm`     | string                 | Override `name` → npm name (for scoped packages).    |
| `access`  | enum                   | `public` \| `restricted`. Default `public`.          |
| `tag`     | string                 | dist-tag. Default `latest`.                          |
| `build`   | string \| array        | `"napi"` \| `"bundled-cli"` (single mode), or an array of entries (each: a bare mode string or `{ mode, name }` with a [name template](#multi-mode-npm-family)). Omitted = vanilla. See [Recipes → Bundled-CLI npm family](#bundled-cli-npm-family). |
| `targets` | (string \| object)[]   | Required when `build` is set.                        |
| `[package.bundle_cli]` | sub-table | Declarative cross-compile for `build = "bundled-cli"` rows. Fields: `bin` (required), `crate_path` (default `"."`), `features` (default `[]`), `no_default_features` (default `false`). See [Recipes → Bundled-CLI npm family](#bundled-cli-npm-family). |

> [!IMPORTANT]
> **`package.json` MUST declare a non-empty `repository` field.** `putitoutthere`
> publishes npm packages with `npm publish --provenance` on the OIDC
> trusted-publisher path; the npm CLI hard-requires `repository` so the
> registry can verify the artifact was built from the repo the trusted
> publisher declares. Preflight rejects the run with
> `PIOT_NPM_MISSING_REPOSITORY` when the field is missing or empty.
>
> Canonical shape (use this in every npm `package.json` you publish through
> `putitoutthere`):
>
> ```json
> {
>   "repository": {
>     "type": "git",
>     "url": "git+https://github.com/<owner>/<repo>.git",
>     "directory": "<path/to/package>"
>   }
> }
> ```
>
> `directory` is needed for monorepo packages so npm can locate the source
> within the repo. The legacy single-string form
> (`"repository": "git+https://github.com/<owner>/<repo>.git"`) is also
> accepted.

> [!IMPORTANT]
> **`package.json`'s `name` MUST match the configured shape.** Preflight
> verifies this at PR time (via `check.yml`) and again before any publish
> side effect:
>
> - `name` matches `[[package]].name` (or the `npm` override) —
>   `PIOT_NPM_NAME_MISMATCH`. `npm publish` packs the manifest `name`, but
>   `putitoutthere`'s idempotency check (`npm view <name>`) and the tag /
>   release-URL bookkeeping use the configured name; a divergence breaks
>   idempotency and can publish under an unexpected name. Use the `npm`
>   override when the registered name differs from `[[package]].name`
>   (e.g. a scoped `@scope/foo`).

### Example: polyglot Rust library

One Rust crate feeds three artifacts:

```toml
[[package]]
name = "my-rust"
kind = "crates"
path = "crates/my-rust"
globs = ["crates/my-rust/**"]

[[package]]
name       = "my-py"
kind       = "pypi"
path       = "py/my-py"
globs      = ["py/my-py/**"]
build      = "maturin"
targets    = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]
depends_on = ["my-rust"]

[[package]]
name       = "my-cli"
kind       = "npm"
path       = "packages/ts"
globs      = ["packages/ts/**"]
build      = "bundled-cli"
targets    = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]
depends_on = ["my-rust"]
```

A change to `crates/my-rust/` cascades: the crate ships, then the Python
wheels and npm family ship on top, version-bumped to match.

### Example: multi-package workspace

```toml
[[package]]
name  = "@my/core"
kind  = "npm"
path  = "packages/core"
globs = ["packages/core/**"]

[[package]]
name       = "@my/parser"
kind       = "npm"
path       = "packages/parser"
globs      = ["packages/parser/**"]
depends_on = ["@my/core"]
```

## Trailer

The trailer is **optional**. Default behavior is `patch` whenever a package's
`globs` matched changed files.

Grammar:

```
release: <bump> [pkg1, pkg2, ...]
```

`<bump>` is `patch` | `minor` | `major` | `skip`. The optional package list
scopes a non-default bump to specific packages.

| Trailer                  | Effect                                                                 |
|--------------------------|------------------------------------------------------------------------|
| *(none)*                 | Cascaded packages bump `patch`.                                        |
| `release: minor`         | Cascaded packages bump `minor`.                                        |
| `release: major`         | Cascaded packages bump `major`.                                        |
| `release: skip`          | No release this commit. Cascade ignored.                               |
| `release: minor [a, b]`  | `a` and `b` bump `minor`; other cascaded packages stay at `patch`.     |

The trailer matches anywhere in the commit body. If multiple `release:` lines
are present, the **last** one wins.

The parser is intentionally lenient on three points: the key is
case-insensitive (`Release:` and `RELEASE:` both match), leading
whitespace before `release:` is allowed, and an empty package list
(`release: minor []`) is equivalent to no list (`release: minor`).
The documented forms above are the canonical shape; the leniency
exists so commits authored under varied review styles still parse.

## Cascade

A package cascades into the release plan when a commit changes any file
matching one of its `globs` since its last tag. If another package
declares `depends_on = ["this-package"]`, that package also cascades.
Transitively, DFS-ordered, with cycle detection at config-load.

Inside a single release, packages publish in topological order of their
`depends_on` graph. If your Python wrapper depends on a Rust crate, the
crate publishes first.

Each handler's first move on publish is `isPublished` — check the registry
for the target version. Already there → skip cleanly. Lets you re-run failed
releases without fighting registry-immutable-publish semantics.

## Manual release

Releases are normally change-driven: a package ships when a commit touches
its `globs`. Sometimes you need to release a package that has **no new
commits** — most often a re-release after a release-pipeline bug is fixed.
The `release_packages` input on `release.yml` does exactly that.

Wire it to a `workflow_dispatch` trigger in your caller workflow:

```yaml
on:
  push: { branches: [main] }
  workflow_dispatch:
    inputs:
      release_packages:
        description: 'Comma-separated name[@bump|version] list'
        required: true

jobs:
  release:
    uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0
    permissions:
      contents: write
      id-token: write
    with:
      release_packages: ${{ inputs.release_packages }}
```

Push-triggered runs leave `release_packages` empty (the `inputs` context is
empty outside `workflow_dispatch`), so the normal change-detected path is
unaffected. Triggering the workflow manually from the Actions tab with
`release_packages` set takes over.

Grammar — a comma-separated list of entries:

```
release_packages: lib-core@minor, lib-py@1.4.0, lib-js
```

Each entry is a package name optionally suffixed with a version spec:

| Entry            | Effect                                                            |
|------------------|-------------------------------------------------------------------|
| `lib-js`         | Release `lib-js`, bumping its last tag by `patch`.                |
| `lib-core@minor` | Release `lib-core`, bumping its last tag by `minor` (or `major`). |
| `lib-py@1.4.0`   | Release `lib-py` at exactly `1.4.0`.                              |

When `release_packages` is set, change detection and `depends_on` cascade
are bypassed entirely: **exactly** the named packages are released, and
nothing else — even a package with real pending changes is left out unless
you name it. An explicit version is used verbatim and is not checked
against the last tag; if that version is already on the registry the
publish-phase `isPublished` check skips it cleanly. Naming a package that
is not declared in `putitoutthere.toml` is an error.

## Trusted publishers

OIDC trusted publishers are the default and recommended auth path.
The reusable workflow also accepts long-lived `CARGO_REGISTRY_TOKEN`
(crates.io) and `NPM_TOKEN` (npm) values via `secrets:` for cases
where Trusted Publishing isn't reachable — most commonly the very
first publish of a brand-new crate or npm package, since Trusted
Publishing on both registries binds to an *already-published*
package and neither has a pending-publisher equivalent. When set,
the OIDC exchange is skipped and the caller-provided token is used
instead. Drop the secret once Trusted Publishing is registered
against the existing package.

For all three registries the OIDC fields are the same: **your**
repository owner/name, **your** workflow filename (`release.yml`),
and optionally a GitHub environment name. Note: you register against
your *own* repository, not against `thekevinscott/putitoutthere` —
see "How auth flows" below for the why.

### crates.io

1. **First publish (brand-new crate).** Trusted Publishing binds to
   an existing crate, so the first `cargo publish` has no OIDC path.
   Either run `cargo publish` once locally with your account's API
   token, or pass `CARGO_REGISTRY_TOKEN` to the reusable workflow via
   `secrets:` to bootstrap through this workflow:

   ```yaml
   jobs:
     release:
       uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0
       secrets:
         CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
   ```

   When `CARGO_REGISTRY_TOKEN` is set, the OIDC step
   (`rust-lang/crates-io-auth-action`) is skipped and the caller-
   provided token is exported to the publish step's environment.
2. Go to `https://crates.io/crates/<crate>/settings` → **Trusted Publishing**
   → **Add**.
3. Fill in: your repo owner, your repo name, workflow filename
   (`release.yml`), environment (optional).
4. Drop the `CARGO_REGISTRY_TOKEN` secret from the workflow once
   Trusted Publishing is registered; subsequent publishes are
   zero-secret on the OIDC path.

### PyPI

1. Go to `https://pypi.org/manage/project/<name>/settings/publishing/` (or
   **Publishing** on the project page).
2. Add a **GitHub** trusted publisher: your repo owner, your repo name,
   workflow filename (`release.yml`), environment (optional).
3. Brand-new project? Use a [pending publisher](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/)
   to skip the bootstrap token.

### npm

1. **First publish (brand-new package).** Trusted Publishing on npm
   binds to an existing package, so the first `npm publish` has no
   OIDC path. Pass `NPM_TOKEN` to the reusable workflow via
   `secrets:` to bootstrap through this workflow:

   ```yaml
   jobs:
     release:
       uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0
       secrets:
         NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
   ```

   When `NPM_TOKEN` is set, it is exported to the publish step's
   environment as `NODE_AUTH_TOKEN` and the npm CLI prefers it over
   the OIDC path. For bundled-cli / napi families the same secret
   authenticates publishes of all per-platform sub-packages on first
   publish — once those exist, each one needs its own Trusted
   Publisher registration (the bypass is a one-time bootstrap, not
   a permanent path).
2. Go to `https://www.npmjs.com/package/<name>/access` → **Require trusted
   publisher**.
3. Fill in: your repository, workflow filename (`release.yml`),
   environment (optional). Repeat for every per-platform sub-package
   for bundled-cli / napi families.
4. Drop the `NPM_TOKEN` secret from the workflow once Trusted
   Publishing is registered; subsequent publishes are zero-secret on
   the OIDC path.

### How auth flows

`crates.io` and `npm` validate OIDC tokens that are minted by the
reusable workflow's `publish` job. The reusable workflow already
sits in your release path, so the OIDC `repository` and
`job_workflow_ref` claims line up with your TP registration.

PyPI is different. Its TP matching filters candidates by
`repository_owner` + `repository_name` *before* checking
`job_workflow_ref` ([Warehouse implementation](https://github.com/pypi/warehouse/blob/main/warehouse/oidc/models/github.py)).
The `repository` claim always reflects the caller's repo — even
inside a reusable workflow — so a TP registered against the
reusable workflow's repo would be filtered out before
`job_workflow_ref` is even checked. PyPI documents this:
"[Reusable workflows cannot currently be used as the workflow in
a Trusted Publisher.](https://docs.pypi.org/trusted-publishers/troubleshooting/)"
Tracked at [pypi/warehouse#11096](https://github.com/pypi/warehouse/issues/11096).

That's why the canonical template puts the PyPI upload step
(`pypa/gh-action-pypi-publish`) directly in *your* workflow,
gated on `needs.release.outputs.has_pypi`. In your workflow context
both claims resolve to your repo, so your TP registration matches.

## Recipes

### Bundled-CLI npm family

Ship a compiled CLI as an npm per-platform family — `npm install -g my-cli`
gives users a working binary on PATH. The `esbuild` / `biome` distribution
shape.

Config:

```toml
[[package]]
name  = "my-cli"
kind  = "npm"
npm   = "my-cli"
build = "bundled-cli"
path  = "packages/ts-cli"
globs = ["packages/ts-cli/**", "crates/my-cli/**"]
targets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
]
```

The engine publishes a per-platform sub-package per target
(`my-cli-<triple>`) plus a top-level whose `optionalDependencies` pin them
at the published version. npm's resolver installs exactly one sub-package
at consumer install time.

With `[package.bundle_cli]` declared (below), the reusable workflow
generates the per-platform launcher and the matching `package.json#bin`
entry for you at build time — both writes are skipped when the consumer
already has either piece committed, so overrides remain trivial. To
override, commit your own `bin/<bundle_cli.bin>.js` at the package root
(or set `package.json#bin` explicitly); the workflow leaves both alone
when present.

Declare `[package.bundle_cli]` so the reusable workflow runs the
cross-compile for you:

```toml
[package.bundle_cli]
bin        = "my-cli"            # `cargo build --bin <this>`
crate_path = "crates/my-cli"     # `cargo build` runs from here; defaults to `.`
# Optional, for crates that gate the CLI behind a Cargo feature
# (the `[[bin]] required-features = ["cli"]` shape):
# features            = ["cli"]
# no_default_features = false
```

For every per-target row the workflow runs `rustup target add
<triple>`, then `cargo build --release --target <triple> --bin
<bin>` from `crate_path`, and copies the resulting binary
(with `.exe` suffix on Windows) into the per-target staging
directory. The engine then packages that directory as the
platform sub-package's artifact. The `main` row carries no
per-target binary (the launcher above is committed source).

> [!NOTE]
> **Constraint.** The binary must build with a vanilla
> `cargo build --release --target <triple> --bin <bin>` from
> `crate_path`, optionally with `--features` /
> `--no-default-features`. Crates that need env vars, alternate
> manifests, Zig-cc cross toolchains, or other cargo flags
> don't fit the recipe — write your own release workflow
> instead.

> [!NOTE]
> **Linux binaries are statically linked against musl.** A
> binary compiled directly against the GitHub-hosted runner's
> glibc carries that glibc's version as a hard runtime
> requirement, so the package would break on any older Linux.
> The reusable workflow sidesteps that by swapping the Linux
> compile triple from `*-linux-gnu*` to `*-linux-musl*` before
> `cargo build` runs (the package's declared triple, the npm
> platform-package name, and everything else consumer-visible
> stay on the original `*-linux-gnu*`; only the binary inside
> switches). Your CLI crate must be musl-compatible:
>
> - If it makes HTTPS calls, prefer `reqwest` with `rustls-tls`
>   features (the default since reqwest v0.13).
> - If it links openssl directly, enable the `vendored` feature
>   on the `openssl` crate.
> - If it uses `git2`, enable `vendored-openssl` /
>   `vendored-libgit2`.
> - If it uses `rusqlite` / `libsqlite3-sys`, enable the
>   `bundled` feature.
> - If it uses `libpq-sys` / `mysqlclient-sys` (Postgres /
>   MySQL clients), prefer a pure-Rust alternative
>   (`sqlx` with `rustls`, `postgres-native-tls` swapped for
>   `postgres-rustls`) — these crates have no clean static path.
>
> The musl build fails loudly at release time with a linker
> error if any of the above is missed, so a forgotten feature
> never produces a broken release — only a blocked one.

> [!WARNING]
> **Do not run `cargo build` in `npm run build` when `[package.bundle_cli]` is configured.**
> The reusable workflow compiles the Rust binary and stages it **after**
> your `npm run build` step, so the engine's musl binary always overwrites
> whatever `npm run build` staged. A build script that also runs cargo with
> the raw `-linux-gnu` triple and copies to `build/<triple>/` does wasted
> work silently. If you migrated from a hand-authored `scripts/build.cjs`
> to `[package.bundle_cli]`, remove the cargo invocation; keep only steps
> that compile or generate genuinely separate artifacts (TypeScript, assets,
> etc.).

Each per-platform sub-package needs its own npm trusted-publisher
registration (a policy on `my-cli` does not cover
`my-cli-x86_64-unknown-linux-gnu`).

> [!NOTE]
> **First-publish lockfile chicken-and-egg.** Some scaffolding will
> populate `optionalDependencies` in your top-level `package.json`
> with entries for `my-cli-<triple>@<version>` ahead of the first
> publish. Those packages don't exist on the registry yet — the
> engine publishes them as part of *this* run — so a locally-generated
> `package-lock.json` / `pnpm-lock.yaml` either fails to install or
> silently drops the entries (pnpm 10 does the silent drop). On the
> next CI run, the strict installs (`npm ci`,
> `pnpm install --frozen-lockfile`) refuse because lockfile and
> `package.json` disagree.
>
> The reusable workflow handles this transparently: every strict
> install in the build matrix and the publish-job rebuild step
> falls back to its non-strict form on failure (with a
> `::warning::` line in the run log so the recovery is visible).
> No consumer-side change is required; you can keep the lockfile
> committed and the `optionalDependencies` declared.

### Multi-mode npm family

For a package that is both a napi-rs Node addon (a `.node` library) **and**
a CLI binary, declare `build` as an array. Each entry contributes its own
per-platform family; the main package's `optionalDependencies` spans both.
The `@swc/core` distribution shape.

```toml
[[package]]
name    = "my-cli"
kind    = "npm"
path    = "packages/ts"
globs   = ["packages/ts/**", "crates/my-cli/**"]
build   = [
  { mode = "napi",        name = "@my-cli/lib-{triple}" },
  { mode = "bundled-cli", name = "@my-cli/cli-{triple}" },
]
targets = [
  "linux-x64-gnu",
  "darwin-arm64",
  "win32-x64-msvc",
]
```

Each entry has a **mode** (`napi` or `bundled-cli`) and a **`name`
template** for its platform packages. Variables:

| Variable    | Resolves to                                                       |
|-------------|-------------------------------------------------------------------|
| `{name}`    | The main package's npm name (`pkg.npm` if set, else `pkg.name`).  |
| `{scope}`   | Scope without `@` for scoped names (e.g. `myorg`); `""` if unscoped. |
| `{base}`    | Name without scope (e.g. `core` for `@myorg/core`).              |
| `{triple}`  | Target triple as written in `targets` — required in the template. |
| `{mode}`    | The entry's mode (`napi` / `bundled-cli`).                        |

`{version}` is intentionally not surfaced — platform package names are
immutable identifiers; the version is pinned in `optionalDependencies`,
not the name.

**Single-mode (string) form is preserved.** `build = "napi"` and
`build = ["napi"]` are equivalent and produce the historical
`<name>-<triple>` platform-package names byte-for-byte. The mode-infix
artifact-directory naming (`<name>-napi-<triple>`, `<name>-bundled-cli-<triple>`)
only applies when `build` has more than one entry.

**Validation rules** enforced at config load:

- Each `mode` value (`napi`, `bundled-cli`) appears at most once per package.
- Every `name` template must contain `{triple}`.
- Unknown placeholders are rejected.
- All entries must produce distinct platform-package name templates.

Each platform package across **every** family needs its own npm
trusted-publisher registration. For the config above, that's
`@my-cli/lib-linux-x64-gnu`, `@my-cli/lib-darwin-arm64`,
`@my-cli/lib-win32-x64-msvc`, `@my-cli/cli-linux-x64-gnu`,
`@my-cli/cli-darwin-arm64`, `@my-cli/cli-win32-x64-msvc` — six total,
one per platform package, plus the top-level `my-cli`.

### Rust CLI inside a PyPI wheel

`pip install my-lib` on any platform gets a working CLI on `PATH` without
the user installing a Rust toolchain. The `ruff` / `uv` / `pydantic-core`
pattern.

Config:

```toml
[[package]]
name  = "my-py"
kind  = "pypi"
build = "maturin"
path  = "packages/python"
globs = ["packages/python/**", "crates/my-rust/**"]
targets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
]
depends_on = ["my-rust"]

[package.bundle_cli]
bin        = "my-cli"
stage_to   = "src/my_py/_binary"
crate_path = "crates/my-rust"
# Optional. Forwarded to `cargo build` when the binary lives behind
# `[[bin]] required-features = ["cli"]` (the lib-with-optional-CLI shape:
# ruff / uv / pydantic-core / biome / swc). Empty list = no `--features`
# flag, identical to omitting the key.
features            = ["cli"]
no_default_features = false
```

The reusable workflow cross-compiles the binary per target and stages it
into the package source tree before maturin runs. The same musl
compatibility requirement that applies to bundled-cli npm packages
applies here — see [Linux binaries are statically linked against
musl](#bundled-cli-npm-family) above for the list of Cargo features to
flip when the build fails on a system-library dependency.

Your `pyproject.toml` ties the staged binary into a `console_scripts`
entry:

```toml
[project.scripts]
my-cli = "my_py._binary:entrypoint"

[tool.maturin]
include = ["src/my_py/_binary/**"]
```

Launcher in `packages/python/src/my_py/_binary/__init__.py`:

```python
import os, sys
from pathlib import Path

def entrypoint():
    here = Path(__file__).parent
    binary = here / ("my-cli.exe" if os.name == "nt" else "my-cli")
    if not binary.exists():
        sys.stderr.write(f"my-cli binary not found at {binary}\n")
        sys.exit(1)
    os.execv(binary, [str(binary), *sys.argv[1:]])
```

## Python version source — required shape

Every `kind = "pypi"` package **must** declare `[project].dynamic = ["version"]`
in its `pyproject.toml`. Static `[project].version = "..."` literals are
rejected at PR time by `putitoutthere check` (error code
`PIOT_PYPI_STATIC_VERSION`) and again at publish time before any side effect.

Why the requirement exists: putitoutthere does not edit `pyproject.toml`
at release time (per the "no version computation" design commitment) — a
static literal silently ships the previous release's wheel/sdist because
the build backend reads whatever is on disk. The fix is the same across
all supported Python build backends: declare the version as dynamic and
let the backend derive it.

### Recommended: `hatch-vcs`

The blessed path for new Python packages. The version comes from the
latest git tag at build time, so no manual `pyproject.toml` edit is ever
needed.

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

The reusable workflow sets `SETUPTOOLS_SCM_PRETEND_VERSION` on the build
step to the planned version, which `hatch-vcs` honors. Per-package
variants like `SETUPTOOLS_SCM_PRETEND_VERSION_FOR_<PKG>` are silently
ignored by `hatch-vcs`; only the global form works.

### Also accepted

- **`setuptools-scm`** (for setuptools-backed projects): same idea, same
  env-var handoff. Add `setuptools-scm` to `[build-system].requires`,
  declare `dynamic = ["version"]`, and the workflow's
  `SETUPTOOLS_SCM_PRETEND_VERSION` injection covers the build step.
- **Maturin** (for Python packages built from a Rust crate): pyproject
  declares `dynamic = ["version"]`; the version source is the sibling
  `Cargo.toml`'s `[package].version`. putitoutthere bumps `Cargo.toml`
  before `maturin build` runs.

If a Python package can't fit any of these three shapes, it's outside
putitoutthere's scope — write your own release workflow.

## Error codes

Every consumer-visible failure carries a stable `PIOT_*` code in the
GitHub Actions `::error::` annotation and in the corresponding log
line. Grep the run log for the code, then look it up here.

| Code | What trips it | Where it fires |
|------|---------------|----------------|
| `PIOT_NPM_MISSING_REPOSITORY` | An npm package's `package.json` is missing a non-empty `repository` field. Required by `npm publish --provenance`. | PR-time (`check.yml`) and publish-time preflight. See [`kind = "npm"`](#kind--npm). |
| `PIOT_NPM_NAME_MISMATCH` | `package.json`'s `name` disagrees with the configured `[[package]].name` (or `npm` override). `npm publish` packs the manifest name while piot's idempotency/tag bookkeeping uses the configured name. | PR-time and publish-time. See [`kind = "npm"`](#kind--npm). |
| `PIOT_CRATES_NAME_MISMATCH` | `Cargo.toml`'s `[package].name` disagrees with the configured `[[package]].name` (or `crate` override). | PR-time and publish-time. See [`kind = "crates"`](#kind--crates). |
| `PIOT_CRATES_MISSING_METADATA` | `Cargo.toml` lacks `[package].description` and/or `license` (or `license-file`). crates.io 400s without it. | PR-time and publish-time. |
| `PIOT_CRATES_FEATURE_NOT_DECLARED` | A `features` entry (on the package or in `bundle_cli.features`) is not declared in the crate's `[features]` table. | PR-time and publish-time. |
| `PIOT_CRATES_MISSING_BIN` | `bundle_cli.bin` is set but the target crate has no `[[bin]]` (or implicit-binary) of that name. | PR-time and publish-time. |
| `PIOT_CRATES_WORKSPACE_VERSION_MISMATCH` | `Cargo.toml` declares `version.workspace = true` but no ancestor declares `[workspace.package].version`. | PR-time and publish-time. |
| `PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED` | crates.io returned 404 because the crate has never been published. Trusted Publishing binds to an already-published crate. Bootstrap with `CARGO_REGISTRY_TOKEN` (see [crates.io](#cratesio) above). | Publish-time only — the registry's response is the signal. |
| `PIOT_PYPI_STATIC_VERSION` | `pyproject.toml` declares a static `[project].version = "..."` literal. Use `[project].dynamic = ["version"]` instead (see [Python version source](#python-version-source--required-shape)). | PR-time and publish-time. |
| `PIOT_PYPI_NAME_MISMATCH` | `pyproject.toml`'s `[project].name` disagrees with the configured `[[package]].name` (or `pypi` override). | PR-time and publish-time. |
| `PIOT_PYPI_BUILD_BACKEND_MISMATCH` | `[build-system].build-backend` is set but doesn't match the configured `build` mode (`maturin` → `maturin`, `setuptools` → `setuptools.build_meta`, `hatch` → `hatchling.build`). | PR-time and publish-time. |
| `PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND` | `[project].dynamic` contains `"version"` but no `[tool.hatch.version]` or `[tool.setuptools_scm]` block declares the source. | PR-time and publish-time. |
| `PIOT_PYPI_MATURIN_INCLUDE_MISSING` | `bundle_cli` is set on a maturin package but `[tool.maturin].include` doesn't cover `bundle_cli.stage_to`. The cross-compiled binary wouldn't land in any wheel. | PR-time and publish-time. |
| `PIOT_AUTH_NO_TOKEN` | The publish job reached the registry-auth step with no token resolved (neither an OIDC-minted token nor a caller-provided long-lived token). Almost always means the reusable workflow's trusted-publisher exchange failed silently or the caller-provided secret was empty. | Publish-time only. |
| `PIOT_PUBLISH_EMPTY_PLAN` | `publish` was invoked but `plan` returned zero rows for a reason other than `release: skip`. The reusable workflow's gate normally prevents this; if it fires, the gate was bypassed or the engine is inconsistent. | Publish-time only. |

## Release health

The registry is the source of truth; git tags are putitoutthere's record
of what's been released (it derives "last released version" from them).
Two features keep the two in sync.

### `status` — registry-vs-tag drift report

`status` reconciles, per package, the latest git tag against the
registry's latest published version — over the public registry APIs
(crates.io / npm / PyPI), no auth required — and flags any drift:

```
package     tag      registry  state
mypkg-rust  —        0.0.1     ⚠ published, untagged
mypkg-npm   0.0.1    0.0.1     ✓ in sync
mypkg-py    0.0.1    0.0.1     ✓ in sync
```

| State | Meaning |
|-------|---------|
| `in sync` | the latest tag matches the registry's latest version |
| `unreleased` | no tag, and nothing published |
| `published, untagged` | live on the registry but no tag — the drift that strands a package |
| `tagged, unpublished` | tagged, but the registry doesn't have that version |
| `version mismatch` | the tag and the registry disagree on the latest version |
| `registry unreachable` | the registry couldn't be reached (reported, never gated) |

Why it matters: a half-failed run that publishes a version but never
tags it leaves the package `published, untagged`. Because the planner
reads "last released" from tags, that package then looks unreleased,
skips its already-live version forever, and can never bump — while its
dependents keep bumping past it. `status` surfaces that in one line.

- `--check` exits non-zero on any drift state — run it as a CI gate so
  drift can't merge unnoticed.
- `--json` emits the rows as machine-readable JSON.

`putitoutthere` is published to npm, so run it with `npx` (it reads your
git tags, so make sure they're fetched):

```bash
# Report drift across every package in putitoutthere.toml:
npx putitoutthere status

# Exit non-zero if anything has drifted:
npx putitoutthere status --check
echo $?            # 1 when drifted, 0 when in sync

# Machine-readable rows:
npx putitoutthere status --json
# [{"package":"mypkg-rust","kind":"crates","tag":null,"tagVersion":null,
#   "registry":"0.0.1","registryUnreachable":false,
#   "state":"published, untagged","drift":true}, …]
```

To gate every PR on release-state drift, add a step to any workflow —
checking out tags so `status` can compare them against the registry:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0          # status compares local tags vs the registry
- run: npx putitoutthere status --check
```

### Auto-heal

The most common drift — a version live on the registry but missing its
tag — heals itself. **There's nothing to run**: when a release runs and
`publish` finds a version already published, it writes the missing tag
(at the release commit) instead of skipping silently. A package stranded
by an earlier half-failed run recovers on its **next release run** — it
has no tag, so it's force-selected into the plan, found already-published,
and tagged. No manual tag surgery. Idempotent: already-tagged packages
are untouched.

If the repo has nothing else to release, heal the stuck package now by
triggering a [manual release](#manual-release) for it
(`release_packages`).

## Project layout

- [`CHANGELOG.md`](./CHANGELOG.md) — per-release changes.
- [`MIGRATIONS.md`](./MIGRATIONS.md) — per-version upgrade guide.
- [`notes/design-commitments.md`](./notes/design-commitments.md) — non-goals.
- [`notes/internals/`](./notes/internals/) — internal contracts (artifact
  layout, runner setup) that the reusable workflow honors so consumers don't
  have to.
