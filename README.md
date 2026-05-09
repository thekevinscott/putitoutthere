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
| `python_version` | `3.12`       | You need a specific Python version for `kind = "pypi"` build steps.      |

### 1b. Recommended: drop in `.github/workflows/build-check.yml`

Run the same plan + build matrix on every PR, with the publish step
structurally absent. This is the cheapest way to catch a malformed
`putitoutthere.toml`, missing `repository` field, or per-target build
break **before** the merge — by the time the release workflow runs,
the merge has already happened and the only recourse is a fix-up PR.

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

### `kind = "pypi"`

| Field        | Type                   | Notes                                              |
|--------------|------------------------|----------------------------------------------------|
| `pypi`       | string                 | Override `name` → PyPI registered name.            |
| `build`      | enum                   | `maturin` \| `setuptools` \| `hatch`. Required.    |
| `targets`    | (string \| object)[]   | Required when `build = "maturin"`. Triples or `{ triple, runner }` objects. |
| `bundle_cli` | table                  | Opt-in: cross-compile a Rust CLI per target and stage it into each wheel. Only valid with `build = "maturin"`. See [Recipes → Rust CLI inside a PyPI wheel](#rust-cli-inside-a-pypi-wheel). |

### `kind = "npm"`

| Field     | Type                   | Notes                                                |
|-----------|------------------------|------------------------------------------------------|
| `npm`     | string                 | Override `name` → npm name (for scoped packages).    |
| `access`  | enum                   | `public` \| `restricted`. Default `public`.          |
| `tag`     | string                 | dist-tag. Default `latest`.                          |
| `build`   | string \| array        | `"napi"` \| `"bundled-cli"` (single mode), or an array of entries (each: a bare mode string or `{ mode, name }` with a [name template](#multi-mode-npm-family)). Omitted = vanilla. See [Recipes → Bundled-CLI npm family](#bundled-cli-npm-family). |
| `targets` | (string \| object)[]   | Required when `build` is set.                        |

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

## Trusted publishers

OIDC trusted publishers are the default and recommended auth path.
The reusable workflow also accepts a long-lived `CARGO_REGISTRY_TOKEN`
via `secrets:` for cases where Trusted Publishing isn't reachable —
most commonly the very first publish of a brand-new crate, since
Trusted Publishing on crates.io binds to an *already-published* crate
and there's no pending-publisher equivalent. When set, the OIDC
exchange is skipped and the caller-provided token is used instead.
Drop the secret once Trusted Publishing is registered against the
existing crate.

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

1. Publish at least one version of your package with a classic
   `NODE_AUTH_TOKEN` so the package exists on the registry. (npm's trusted
   publisher requires an existing package.)
2. Go to `https://www.npmjs.com/package/<name>/access` → **Require trusted
   publisher**.
3. Fill in: your repository, workflow filename (`release.yml`),
   environment (optional).
4. Delete the bootstrap token.

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

You author the launcher script that picks the right per-platform binary
once. `package.json`:

```json
{
  "name": "my-cli",
  "bin": { "my-cli": "bin/my-cli.js" }
}
```

`bin/my-cli.js`:

```js
#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { platform, arch } = process;

const triples = {
  'linux-x64':    'x86_64-unknown-linux-gnu',
  'linux-arm64':  'aarch64-unknown-linux-gnu',
  'darwin-x64':   'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64':    'x86_64-pc-windows-msvc',
};

const triple = triples[`${platform}-${arch}`];
if (!triple) {
  console.error(`my-cli: unsupported platform ${platform}-${arch}`);
  process.exit(1);
}

const pkg = `my-cli-${triple}`;
const binary = require.resolve(`${pkg}/bin/my-cli${platform === 'win32' ? '.exe' : ''}`);
const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });
process.exit(result.status ?? 1);
```

Each per-platform sub-package needs its own npm trusted-publisher
registration (a policy on `my-cli` does not cover
`my-cli-x86_64-unknown-linux-gnu`).

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
```

The reusable workflow cross-compiles the binary per target and stages it
into the package source tree before maturin runs. Your `pyproject.toml`
ties the staged binary into a `console_scripts` entry:

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

## Dynamic-version PyPI gotcha

If your `pyproject.toml` uses `[project].dynamic = ["version"]` with
`hatch-vcs` or `setuptools-scm`, the build backend derives the version from
the latest git tag at build time — which is still the **previous** release
when the build runs. Without a handoff, the sdist ships as
`<pkg>-X.Y.Z.devN.tar.gz` instead of `<pkg>-X.Y.Z.tar.gz`.

The reusable workflow sets `SETUPTOOLS_SCM_PRETEND_VERSION` to the planned
version on the build step, which both `setuptools-scm` and `hatch-vcs`
honor. Per-package variants like `SETUPTOOLS_SCM_PRETEND_VERSION_FOR_<PKG>`
are silently ignored by `hatch-vcs`; only the global form works.

## Project layout

- [`CHANGELOG.md`](./CHANGELOG.md) — per-release changes.
- [`MIGRATIONS.md`](./MIGRATIONS.md) — per-version upgrade guide.
- [`notes/design-commitments.md`](./notes/design-commitments.md) — non-goals.
- [`notes/internals/`](./notes/internals/) — internal contracts (artifact
  layout, runner setup) that the reusable workflow honors so consumers don't
  have to.
