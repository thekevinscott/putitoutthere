# Rust + napi npm

This page is for projects that ship **two artifacts from one Rust
core**:

- A plain crate to crates.io.
- A napi-rs package to npm, distributed as a per-platform family
  (`{name}-<triple>` × N + a top-level with `optionalDependencies`).

No PyO3 wheels. A common shape for Node-native libraries with a
Rust hot path (`@napi-rs/canvas`, `lightningcss`, `@swc/core` and
friends).

If that's your shape, `putitoutthere` covers the publishing layer.
This page is the subset of [Polyglot Rust library](/guide/shapes/polyglot-rust)
without the PyPI pieces.

## What piot covers

| Responsibility                                                                | piot   | Your workflow |
|-------------------------------------------------------------------------------|--------|---------------|
| Decide which of the two packages ship on a given merge (cascade)              | ✅     |               |
| Topologically order the publishes (crate before napi family)                  | ✅     |               |
| Compute the next version from a commit trailer                                | ✅     |               |
| Per-registry OIDC trusted publishing (crates.io, npm)                         | ✅     |               |
| Skip-if-already-published idempotency                                         | ✅     |               |
| Publish a napi family with synthesised per-platform packages + `optionalDependencies` top-level | ✅ | |
| Emit a per-target build matrix with the right runner per triple               | ✅     |               |
| Run `napi build --target …` — the compilation itself                          |        | ✅            |
| Install Node, Rust, and napi-cli on runners                                   |        | ✅ ([runner prereqs](/guide/runner-prerequisites)) |
| Register the trusted-publisher policy on each registry (one-time)             |        | ✅            |

See [npm platform packages](/guide/npm-platform-packages) for the
full detail on the family layout piot synthesises.

## Configuration shape

Two `[[package]]` entries. The npm package declares
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
name = "my-napi"
kind = "npm"
npm  = "@scope/my-lib"                     # top-level published name
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

piot publishes `@scope/my-lib-<triple>` for every target, then
rewrites `@scope/my-lib`'s `optionalDependencies` to pin each
one at the freshly-published version, and publishes the top-level
last. At `npm install @scope/my-lib`, npm's resolver picks the
single sub-package matching the user's `os` + `cpu` + `libc`.

## Workflow shape

The build job runs `napi build` once per target:

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
    - uses: actions/setup-node@v4
      if: matrix.kind == 'npm'
      with: { node-version: '20' }
    - uses: dtolnay/rust-toolchain@stable
      if: matrix.kind == 'npm'
      with:
        targets: ${{ matrix.target }}
    - name: Build napi addon
      if: matrix.kind == 'npm'
      run: |
        cd ${{ matrix.path }}
        npm ci
        npx napi build --release --target ${{ matrix.target }} --platform
    - uses: actions/upload-artifact@v4
      with:
        name: ${{ matrix.artifact_name }}
        path: ${{ matrix.artifact_path }}
```

Crates have no per-target build. The `if: matrix.kind == 'npm'`
guard keeps the build job idle on crate rows.

## Per-target runners

piot's planner maps each triple to a sensible default runner
(`ubuntu-24.04-arm` for aarch64 Linux, `macos-latest` for Darwin,
`windows-latest` for msvc, `ubuntu-latest` otherwise). To
override per target, use object-form `targets` entries:

```toml
targets = [
  "x86_64-unknown-linux-gnu",
  { triple = "aarch64-unknown-linux-gnu", runner = "ubuntu-24.04-arm" },
  { triple = "aarch64-apple-darwin",      runner = "macos-14" },
]
```

The emitted matrix rows carry a `runner` field the workflow reads
as `runs-on`.

## Publish job prerequisites

- **Node on PATH**, with `registry-url: https://registry.npmjs.org`
  on `actions/setup-node` so provenance resolution works.
- **Rust toolchain on PATH.** The crates handler shells out to
  `cargo publish`.
- **A git committer identity.** piot cuts an annotated tag per
  package.

See [runner prerequisites](/guide/runner-prerequisites).

## One-time prerequisites before your first release

1. Register trusted publishers on crates.io and npm. See
   [Authentication](/guide/auth).
2. Declare `[package.trust_policy]` on each `[[package]]`.
3. Delete long-lived `CARGO_REGISTRY_TOKEN` / `NPM_TOKEN` secrets
   once OIDC is working.

## Gotchas specific to this shape

- **glibc vs. musl.** Linux triples carry a `libc` marker on the
  plan row (`glibc` or `musl`). The per-platform `package.json`
  piot synthesises sets `libc` accordingly, so glibc consumers
  don't accidentally resolve the musl build. If you need both,
  declare both targets — `x86_64-unknown-linux-gnu` and
  `x86_64-unknown-linux-musl` — and build both in the matrix.
- **Unknown triples rejected at plan time.** Targets that don't
  match a known OS + CPU pattern (e.g. `riscv64-*`,
  `powerpc64le-*`) are rejected by `plan` with an error. The old
  behaviour of silently synthesising a no-constraints
  per-platform package is gone; add support triple-by-triple as
  napi-rs gains them.
- **napi build without `--platform` ships a non-platform
  tarball.** The `--platform` flag tells napi-cli to emit the
  `{name}.{triple}.node` filename piot expects in the artifact
  directory. Without it, the per-platform package's `main` won't
  find the addon.
- **Shipping a CLI binary alongside the napi addon.** piot does
  not support mixing `bundled-cli` and `napi` under one top-level
  package. If that's your shape, see
  [Dual-family npm](/guide/shapes/dual-family-npm) for the
  split-package workaround.
- **Two tag schemes.** piot tags each package independently as
  `{name}-v{version}`. If your existing setup used a single
  shared tag, consumers reading tags need to update.

## Further reading

- [npm platform packages](/guide/npm-platform-packages) — the
  family pattern in detail.
- [Polyglot Rust library](/guide/shapes/polyglot-rust) — the
  superset with PyPI added.
- [Rust + PyO3 wheels](/guide/shapes/rust-pyo3) — the inverse:
  crate + PyPI, no npm.
- [Bundled-CLI npm family](/guide/shapes/bundled-cli) — if you
  ship a CLI binary rather than a napi addon.
- [Dual-family npm](/guide/shapes/dual-family-npm) — if you need
  both a napi addon *and* a CLI binary from the same Rust core.
- [Runner prerequisites](/guide/runner-prerequisites).
- [Configuration reference](/guide/configuration).
