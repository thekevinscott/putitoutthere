# Single-package Rust crate

This page is for projects that ship **one crate to crates.io** from
a single `Cargo.toml` — no PyO3 wheels, no napi npm package, no
cross-compiled binaries. The plainest Rust-library shape.

If that's your repo, `putitoutthere` covers every step from "merge
to `main`" through "the new version is on crates.io." This page is
the end-to-end walkthrough.

## What piot covers

| Responsibility                                                                 | piot   | Your workflow |
|--------------------------------------------------------------------------------|--------|---------------|
| Decide when to ship (on every merge, or on a schedule)                         | ✅     |               |
| Compute the next version from a commit trailer or default patch-bump           | ✅     |               |
| Rewrite `[package].version` in `Cargo.toml`                                    | ✅     |               |
| OIDC trusted publishing to crates.io                                           | ✅     |               |
| Skip-if-already-published idempotency (`GET` crates.io before upload)          | ✅     |               |
| Run `cargo publish` (with `--features` and `--no-default-features` if set)     | ✅     |               |
| Cut a git tag + GitHub Release                                                 | ✅     |               |
| Install Rust toolchain on the publish runner                                   |        | ✅ ([runner prereqs](/guide/runner-prerequisites)) |
| Register the trusted-publisher policy on crates.io (one-time, out-of-CI)       |        | ✅            |

crates.io compiles source on upload — there is no cross-target build
matrix for a plain crate. `cargo publish` runs on whatever runner
your `publish` job sits on. If you want pre-built binary archives
attached to the GitHub Release, compose with
[`cargo-dist`](https://axodotdev.github.io/cargo-dist/) alongside
piot; piot doesn't emit release tarballs.

## Configuration shape

A single `[[package]]` entry with `kind = "crates"`. For a
single-package repo, pick `tag_format = "v{version}"` to stay on
the `v0.4.1`-style timeline most crates already use.

```toml
[putitoutthere]
version = 1

[[package]]
name       = "my-crate"
kind       = "crates"
path       = "."                           # Cargo.toml at repo root
paths      = ["src/**", "Cargo.toml", "Cargo.lock"]
tag_format = "v{version}"                  # single-package shape
# crate   = "my-crate"                     # override if crates.io name ≠ piot name
# features            = ["cli"]            # cargo publish --features
# no_default_features = false              # --no-default-features
```

Keep `Cargo.lock` in `paths` if it's tracked in the repo — a
dependency bump should cascade a publish.

## Workflow shape

`putitoutthere init` scaffolds `release.yml` with three jobs:
`plan → build → publish`. For a plain crate, the build job is
minimal (or absent — piot doesn't need build artifacts for
crates.io). Minimum working example:

```yaml
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: release
  cancel-in-progress: false

permissions:
  contents: read
  id-token: write

jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.plan.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - id: plan
        uses: thekevinscott/put-it-out-there@v0
        with:
          command: plan

  publish:
    needs: plan
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: dtolnay/rust-toolchain@stable
      - name: Configure git identity
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
      - uses: thekevinscott/put-it-out-there@v0
        with:
          command: publish
        env:
          CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}   # optional, fallback only
```

No `build` job is shown — crates.io takes source, not artifacts.
If you want to run `cargo test` / `cargo clippy` in the same
workflow, add a separate job that gates `publish` via `needs:`.

## Publish job prerequisites

The scaffolded `publish` job assumes OIDC plus a Node runtime
(piot itself is a Node action). For this shape, it also needs:

- **Rust toolchain on PATH** (`dtolnay/rust-toolchain@stable` or
  equivalent). piot's crates handler shells out to `cargo publish`;
  without `cargo` on PATH the job fails with `spawn cargo ENOENT`.
- **A git committer identity.** piot cuts an annotated tag
  (`git tag -a`), which needs `user.name` + `user.email`.

See [runner prerequisites](/guide/runner-prerequisites) for the
cross-shape reference.

## One-time prerequisites before your first release

1. Register a [trusted publisher](/guide/auth) on crates.io for
   your crate. Requires an existing crate on the
   registry; if this is your first ever publish, you'll need a
   one-time bootstrap with a scoped `CARGO_REGISTRY_TOKEN` and
   then switch to OIDC.
2. Declare the expected workflow in `[package.trust_policy]` so
   `doctor` catches a rename mismatch before the publish tries:

   ```toml
   [package.trust_policy]
   workflow    = "release.yml"
   environment = "release"     # optional; include if your crates.io
                               # trust policy pins an environment
   ```

3. Delete any long-lived `CARGO_REGISTRY_TOKEN` repo secret once
   OIDC is working, so nothing can accidentally fall back.

## Gotchas specific to this shape

- **crates.io is immutable.** Once a version is published, it
  cannot be re-used even if you yank it. piot's completeness check
  runs before anything ships so partial-publish is rare, and when
  it happens the right move is bump-and-republish rather than
  trying to unpublish. Deleting the git tag after a failed publish
  won't help — crates.io has already recorded the version.
- **`cargo publish` rejects unsaved files.** If your workflow
  modifies tracked files between checkout and the piot step (e.g.
  a local build writes into `src/`), `cargo publish` fails
  `dirty, aborting`. piot's version rewrite to `Cargo.toml` is
  expected and doesn't trigger this; your workflow's own writes do.
- **`--features` / `--no-default-features` live in config, not
  env.** Set them on the `[[package]]` block so every publish uses
  the same flags; don't try to pass them through workflow env vars.
- **Cascade on `Cargo.lock`.** Omit it from `paths` and a pure
  dependency bump (no `src/` diff) won't trigger a release. Most
  crates want it included; libraries that commit `Cargo.lock`
  defensively might not.

## Further reading

- [Getting started](/getting-started) — if you haven't run `init` yet.
- [Configuration reference](/guide/configuration) — every field in
  `putitoutthere.toml`.
- [Authentication](/guide/auth) — crates.io trusted publisher setup.
- [Runner prerequisites](/guide/runner-prerequisites) — Rust
  toolchain, git identity, and other non-obvious runner needs.
- [Polyglot Rust library](/guide/shapes/polyglot-rust) — if you
  also ship PyO3 wheels or a napi npm package from the same core.
- [Rust + PyO3 wheels](/guide/shapes/rust-pyo3) — crate + PyPI,
  no napi.
- [Rust + napi npm](/guide/shapes/rust-napi) — crate + npm, no PyPI.
