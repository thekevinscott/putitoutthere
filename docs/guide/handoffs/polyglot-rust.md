# Polyglot Rust library (dirsql shape)

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
| Diff declared trust-policy config against the workflow file + `GITHUB_WORKFLOW_REF` (catches the caller-filename-pin trap via `doctor`) | ✅ (when `[package.trust_policy]` is declared) | |

The publish-side plus the matrix + runner emission are piot's. The
build-side — compiling the artifacts the matrix demands — is your
workflow's.

## Configuration shape

Three `[[package]]` entries, one per artifact. The Python and npm
packages declare `depends_on = ["the-rust-crate"]` so a change to the
Rust core cascades all three:

```toml
[putitoutthere]
version = 1

[[package]]
name = "dirsql-rust"
kind = "crates"
path = "packages/rust"
paths = ["packages/rust/**", "Cargo.toml", "Cargo.lock"]
features = ["cli"]                         # cargo publish --features cli

[[package]]
name = "dirsql-py"
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
depends_on = ["dirsql-rust"]

[[package]]
name = "dirsql-napi"
kind = "npm"
npm  = "dirsql"                            # published as @scope/dirsql
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
depends_on = ["dirsql-rust"]
```

## Workflow shape

`putitoutthere init` scaffolds `release.yml` with three jobs:
`plan → build → publish`. For a polyglot shape, the `build` job is
yours to fill in. A minimum sketch:

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
via `runs-on: ${{ matrix.runner }}`.

## One-time prerequisites before your first release

1. Register the trusted publisher on each of crates.io, PyPI, npm.
   See [Authentication](/guide/auth). All three pin the **caller
   workflow filename** in the JWT claim — if you rename `release.yml`,
   each registry's policy needs to be re-registered first or the
   publish fails with HTTP 400. Declare the expected workflow in
   `[package.trust_policy]` so `doctor` catches a mismatch before
   the publish tries.
2. Delete any long-lived `NPM_TOKEN` / `PYPI_API_TOKEN` /
   `CARGO_REGISTRY_TOKEN` repo secrets once OIDC is working, so
   nothing can accidentally fall back.

## Gotchas specific to this shape

- **Shipping a Rust CLI inside the PyPI wheel.** A common pattern is
  to stage a `cargo build --bin …` binary into the Python source
  tree before `maturin build` runs, so the wheel ships a `console_scripts`
  entry pointing at the binary. piot doesn't have a pre-build hook
  for this yet; the staging step stays in your `build` job, and the
  wheel is what piot publishes.
- **Two tag schemes.** piot tags each package independently as
  `{name}-v{version}` (e.g. `dirsql-rust-v0.3.1`, `dirsql-py-v0.3.1`).
  If your existing setup used a single shared `v0.3.1` tag across
  all three, consumers reading tags (install scripts, docs, release
  pages) need to update.
- **crates.io is immutable.** Once a version is published there,
  it cannot be yanked *and* re-used. piot deliberately does not
  delete tags after a publish failure; the completeness check runs
  before anything ships so partial-publish is rare, and when it
  happens the right move is to bump-and-republish rather than try
  to unpublish.
- **Dynamic versions in `pyproject.toml`** (hatch-vcs,
  setuptools-scm) interact with piot's version rewrite in ways that
  aren't fully settled yet — track via
  [#171](https://github.com/thekevinscott/put-it-out-there/issues/171).

## Further reading

- [Concepts](/guide/concepts) — plan/build/publish, cascade, idempotency.
- [npm platform packages](/guide/npm-platform-packages) — the family pattern in detail.
- [Authentication](/guide/auth) — trusted publisher setup.
- [Configuration reference](/guide/configuration).
