# Polyglot Rust library

This page is for libraries that publish **three artifacts from one
Rust core**:

- A plain crate to crates.io.
- PyO3 wheels to PyPI via maturin, targeting multiple platforms.
- A napi-rs package to npm, distributed as a per-platform family
  (`@scope/pkg-<slug>` × N + a top-level with `optionalDependencies`).

If that's your shape, `putitoutthere` covers the publishing layer.
Read this page once before adopting — the fit is good but the
responsibilities split is opinionated.

## What piot covers

| Responsibility                                                                | piot   | Your workflow |
|-------------------------------------------------------------------------------|--------|---------------|
| Decide which of the three packages need to ship on a given merge (cascade)    | ✅     |               |
| Topologically order the publishes (Rust crate before PyO3 wheel before npm)   | ✅     |               |
| Compute the next version from a commit trailer (`release: patch\|minor\|major`) | ✅     |               |
| Per-registry OIDC trusted publishing (crates.io, PyPI, npm)                   | ✅     |               |
| Skip-if-already-published idempotency (each handler `GET`s the registry first)| ✅     |               |
| Publish a napi-rs family with synthesised per-platform packages + `optionalDependencies` top-level | ✅     |               |
| Publish a `bundled-cli` family (per-platform binary packages + launcher)      | ✅     |               |
| Emit a per-target build matrix with the right runner per triple (object-form `targets` entries with `{triple, runner}`) | ✅ | you declare the runner in config |
| Run `maturin build --target …`, `napi build --target …`, `cargo build` — the compilation itself |        | ✅            |
| Attach `.tar.xz` / `.tar.gz` binary archives to the GitHub Release            |        | ✅ (compose with `cargo-dist`) |
| Register the trusted-publisher policy on each registry (one-time, out-of-CI) |        | ✅            |
| Diff declared trust-policy config against the workflow file + `GITHUB_WORKFLOW_REF` (catches the caller-filename-pin trap) | ✅ (when `[package.trust_policy]` is declared) | |

The publish-side plus the matrix + runner emission are piot's. The
build-side — compiling the artifacts the matrix demands — is your
workflow's.

## Configuration shape

Three `[[package]]` entries, one per artifact. The Python and npm
packages declare `depends_on = ["my-crate"]` so a change to the
Rust core cascades all three:

```toml
[putitoutthere]
version = 1

[[package]]
name = "my-crate"
kind = "crates"
path = "packages/rust"
paths = ["packages/rust/**", "Cargo.toml", "Cargo.lock"]
features = ["cli"]                         # cargo publish --features cli

[[package]]
name = "my-py"
kind = "pypi"
build = "maturin"
path = "packages/python"
paths = ["packages/python/**"]
targets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
]
depends_on = ["my-crate"]

[[package]]
name = "my-napi"
kind = "npm"
npm  = "my-lib"                            # published as @scope/my-lib
build = "napi"
path = "packages/ts"
paths = ["packages/ts/**"]
targets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
]
depends_on = ["my-crate"]
```

## Workflow shape

The release workflow runs three phases internally
(`plan → build → publish`). The example below is a hand-written
`release.yml` from the prior model; once the reusable workflow
lands, the consumer file collapses to a few `uses:` lines. Sketch:

```yaml
jobs:
  plan:
    # scaffolded by piot
    outputs:
      matrix: ${{ steps.plan.outputs.matrix }}

  build:
    needs: plan
    if: fromJSON(needs.plan.outputs.matrix).include != null
    strategy:
      matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}
    runs-on: ${{ matrix.runner }}        # you set this per target
    steps:
      # ...install toolchain...
      - if: matrix.kind == 'pypi'
        run: maturin build --release --target ${{ matrix.target }}
      - if: matrix.kind == 'npm'
        run: napi build --release --target ${{ matrix.target }}
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.name }}-${{ matrix.target }}
          path: target/**/release/*

  publish:
    needs: build
    # scaffolded by piot
```

piot's planner maps each triple to a sensible default runner
(`ubuntu-24.04-arm` for aarch64 Linux, `macos-latest` for Darwin,
`windows-latest` for msvc, `ubuntu-latest` otherwise). To override
per target, use object-form `targets` entries in
`putitoutthere.toml`:

```toml
targets = [
  "x86_64-unknown-linux-gnu",                                           # default runner
  { triple = "aarch64-unknown-linux-gnu", runner = "ubuntu-24.04-arm" }, # explicit
  { triple = "aarch64-apple-darwin",      runner = "macos-14" },         # non-default
]
```

The emitted matrix rows carry a `runner` field the workflow reads
as `runs-on` (see the build job above, or let the scaffolded
`release.yml` wire it for you).

## Publish job prerequisites

The scaffolded `publish` job checks out the repo, installs Node, and
invokes the piot action. For this shape, **it also needs**:

- **Python + twine on PATH.** The PyPI handler shells out to
  `twine upload`. Add `actions/setup-python@v5` and `pip install twine`
  before the piot step. See [runner prerequisites](/guide/runner-prerequisites).
- **A git committer identity.** piot cuts an annotated tag per
  package. On hosted runners, `user.name` / `user.email` are unset;
  configure `github-actions[bot]` before the piot step.
- **`SETUPTOOLS_SCM_PRETEND_VERSION_FOR_<PKG>`** when any PyPI package
  uses dynamic versioning (hatch-vcs / setuptools-scm). Maturin reads
  the version from `Cargo.toml`, so a maturin-only shape typically
  doesn't need this — but a mixed shape often does. See
  [dynamic versions](/guide/dynamic-versions).

## One-time prerequisites before your first release

1. Register the trusted publisher on each of crates.io, PyPI, npm.
   See [Authentication](/guide/auth). All three pin the **caller
   workflow filename** in the JWT claim — if you rename `release.yml`,
   each registry's policy needs to be re-registered first or the
   publish fails with HTTP 400. Declare the expected workflow in
   `[package.trust_policy]` so the engine catches a mismatch before
   the publish tries.
2. Delete any long-lived `NPM_TOKEN` / `PYPI_API_TOKEN` /
   `CARGO_REGISTRY_TOKEN` repo secrets once OIDC is working, so
   nothing can accidentally fall back.

## Shipping a Rust CLI inside the PyPI wheel

A common pattern for this shape: stage a `cargo build --bin …`
binary into the Python source tree before `maturin build` runs, so
each wheel ships the binary as package data and a `console_scripts`
entry points at it. Net result: `pip install my-py` on any supported
platform gets `my-cli` on `PATH` — no Rust toolchain needed on the
user's machine. `ruff`, `uv`, and `pydantic-core` all ship this way.

Declare it with `[package.bundle_cli]` on the pypi package:

```toml
[[package]]
name = "my-py"
kind = "pypi"
build = "maturin"
path = "packages/python"
paths = ["packages/python/**", "crates/my-rust/**"]
targets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
]
depends_on = ["my-crate"]

[package.bundle_cli]
bin        = "my-cli"
stage_to   = "src/my_py/_binary"
crate_path = "crates/my-rust"
```

The scaffolded build job does the cross-compile + stage step before
maturin runs, per target. Your `pyproject.toml` ties the staged
binary into a `console_scripts` entry:

```toml
# packages/python/pyproject.toml

[project.scripts]
my-cli = "my_py._binary:entrypoint"

[tool.maturin]
include = ["src/my_py/_binary/**"]  # ship the binary as package data
```

…with a small launcher in `packages/python/src/my_py/_binary/__init__.py`
that `os.execv`s into the staged binary:

```python
# packages/python/src/my_py/_binary/__init__.py
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

Full field reference: [Configuration → Bundled CLI](/guide/configuration#bundled-cli).

## Gotchas specific to this shape

- **Two tag schemes.** piot tags each package independently as
  `{name}-v{version}` (e.g. `my-crate-v0.3.1`, `my-py-v0.3.1`).
  If your existing setup used a single shared `v0.3.1` tag across
  all three, consumers reading tags (install scripts, docs, release
  pages) need to update.
- **crates.io is immutable.** Once a version is published there,
  it cannot be yanked *and* re-used. piot deliberately does not
  delete tags after a publish failure; the completeness check runs
  before anything ships so partial-publish is rare, and when it
  happens the right move is to bump-and-republish rather than try
  to unpublish.
- **Dynamic versions in `pyproject.toml`.** If any PyPI package uses
  `[project].dynamic = ["version"]` with hatch-vcs / setuptools-scm,
  piot skips the pyproject rewrite and the build backend derives the
  version from git. Without the env-var handoff, the sdist ends up
  named `<pkg>-X.Y.Z.dev<N>.tar.gz` instead of `<pkg>-X.Y.Z.tar.gz`.
  See [dynamic versions](/guide/dynamic-versions).

## Further reading

- [Concepts](/guide/concepts) — plan/build/publish, cascade, idempotency.
- [npm platform packages](/guide/npm-platform-packages) — the family pattern in detail.
- [Authentication](/guide/auth) — trusted publisher setup.
- [Runner prerequisites](/guide/runner-prerequisites) — twine, git identity, and other non-obvious runner needs.
- [Dynamic versions](/guide/dynamic-versions) — the env-var handoff for `hatch-vcs` / `setuptools-scm`.
- [Configuration reference](/guide/configuration).
- [Single-package Python library](/guide/shapes/python-library) — the simpler shape if you don't need Rust or napi.
