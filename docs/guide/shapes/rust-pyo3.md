# Rust + PyO3 wheels

This page is for projects that ship **two artifacts from one Rust
core**:

- A plain crate to crates.io.
- PyO3 wheels to PyPI via `maturin`, targeting multiple platforms.

No napi-rs, no top-level npm package. A very common shape for
scientific Python libraries with a Rust hot path (`polars`,
`pydantic-core`, `tokenizers`).

If that's your shape, `putitoutthere` covers the publishing layer.
This page is the subset of [Polyglot Rust library](/guide/shapes/polyglot-rust)
without the npm pieces.

## What piot covers

| Responsibility                                                                | piot   | Your workflow |
|-------------------------------------------------------------------------------|--------|---------------|
| Decide which of the two packages ship on a given merge (cascade)              | ✅     |               |
| Topologically order the publishes (crate before wheels)                       | ✅     |               |
| Compute the next version from a commit trailer                                | ✅     |               |
| Per-registry OIDC trusted publishing (crates.io, PyPI)                        | ✅     |               |
| Skip-if-already-published idempotency                                         | ✅     |               |
| Emit a per-target build matrix with the right runner per triple               | ✅     |               |
| Run `maturin build --target …` — the compilation itself                       |        | ✅            |
| Install Python, Rust, maturin, and twine on runners                           |        | ✅ ([runner prereqs](/guide/runner-prerequisites)) |
| Register the trusted-publisher policy on each registry (one-time)             |        | ✅            |

## Configuration shape

Two `[[package]]` entries. The Python package declares
`depends_on = ["my-crate"]` so a change to the Rust core cascades
both publishes.

```toml
[putitoutthere]
version = 1

[[package]]
name = "my-crate"
kind = "crates"
path = "crates/my-crate"
paths = ["crates/my-crate/**", "Cargo.toml", "Cargo.lock"]

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
```

Maturin reads the version from `Cargo.toml`, so piot's rewrite of
`[package].version` in the crate's manifest is what flows into the
wheel metadata. This shape almost never needs the
[dynamic-versions](/guide/dynamic-versions) env-var handoff.

## Workflow shape

`putitoutthere init` scaffolds `release.yml` with three jobs. For
this shape, the build job runs `maturin build` once per target:

```yaml
build:
  needs: plan
  if: fromJSON(needs.plan.outputs.matrix || '[]')[0] != null
  strategy:
    fail-fast: false
    matrix:
      include: ${{ fromJSON(needs.plan.outputs.matrix) }}
  runs-on: ${{ matrix.runs_on }}
  steps:
    - uses: actions/checkout@v4
      with: { fetch-depth: 0 }
    - uses: dtolnay/rust-toolchain@stable
      if: matrix.kind == 'pypi'
      with:
        targets: ${{ matrix.target }}
    - uses: actions/setup-python@v5
      if: matrix.kind == 'pypi'
      with: { python-version: '3.12' }
    - name: Build wheel
      if: matrix.kind == 'pypi'
      run: |
        pip install maturin
        cd ${{ matrix.path }}
        maturin build --release --target ${{ matrix.target }} --out dist
    - uses: actions/upload-artifact@v4
      with:
        name: ${{ matrix.artifact_name }}
        path: ${{ matrix.artifact_path }}
```

Crates have no per-target build — `cargo publish` uploads source,
so the matrix rows for the `crates` package don't need a build
step. The `if: matrix.kind == 'pypi'` guard above keeps the build
job idle on those rows.

## Publish job prerequisites

- **Python + twine on PATH.** The PyPI handler shells out to
  `twine upload`. Add `actions/setup-python@v5` and `pip install
  twine` before the piot step.
- **Rust toolchain on PATH.** The crates handler shells out to
  `cargo publish`.
- **A git committer identity.** piot cuts an annotated tag per
  package.

See [runner prerequisites](/guide/runner-prerequisites).

## One-time prerequisites before your first release

1. Register trusted publishers on crates.io and PyPI. See
   [Authentication](/guide/auth).
2. Declare `[package.trust_policy]` on each `[[package]]` so
   `doctor` catches a rename mismatch before the publish tries.
3. Delete long-lived `CARGO_REGISTRY_TOKEN` / `PYPI_API_TOKEN`
   secrets once OIDC is working.

## Gotchas specific to this shape

- **Two tag schemes.** piot tags each package independently as
  `{name}-v{version}` (e.g. `my-crate-v0.3.1`, `my-py-v0.3.1`). If
  your existing setup used a single shared `v0.3.1` across both,
  consumers reading tags need to update.
- **crates.io is immutable.** Once a version is published there,
  it cannot be re-used. If the wheel build fails partway through a
  release, bump-and-republish; don't try to delete the crate
  version.
- **`manylinux` / `musllinux` wheel naming.** maturin builds
  `manylinux` wheels by default on Linux. If you need `musllinux`
  (Alpine-style), add `--compatibility musllinux_1_2` to the
  maturin command and declare separate targets for the two libc
  variants if you need both. piot's target emitter appends a
  `libc` marker to the plan row for linux triples; your build job
  reads it and passes the right `--compatibility` flag.
- **Wheel that needs a CLI binary too.** If you stage a
  `cargo build --bin …` binary into the Python source tree before
  `maturin build` so the wheel ships a `console_scripts` entry
  pointing at it, keep that staging step in your `build` job. piot
  doesn't have a pre-build hook for it.

## Further reading

- [Polyglot Rust library](/guide/shapes/polyglot-rust) — the
  superset with npm added.
- [Rust + napi npm](/guide/shapes/rust-napi) — the inverse:
  crate + npm, no PyPI.
- [Dynamic versions](/guide/dynamic-versions) — only needed if
  your wheel uses `hatch-vcs` / `setuptools-scm` instead of
  maturin's default.
- [Runner prerequisites](/guide/runner-prerequisites).
- [Configuration reference](/guide/configuration).
