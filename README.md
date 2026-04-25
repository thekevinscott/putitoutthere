# Put It Out There

Polyglot release orchestrator for single-maintainer, LLM-authored projects
that publish to crates.io, PyPI, and npm from one monorepo. One config file,
one CLI, one trailer-driven signal — no per-package release plumbing.

**[Documentation](https://thekevinscott.github.io/putitoutthere/)**

## Install

```sh
npx putitoutthere init
```

This scaffolds a `putitoutthere.toml`, a `release.yml` workflow, and an
`AGENTS.md` file explaining the trailer convention to future
contributors.

For one-off runs without scaffolding:

```sh
pnpm add -D putitoutthere
pnpm putitoutthere plan
```

## Minimum config

```toml
# putitoutthere.toml
[putitoutthere]
version = 1

[[package]]
name  = "my-lib"
kind  = "npm"        # or "pypi" | "crates"
path  = "."
paths = ["src/**", "package.json"]
```

`paths` are the globs that trigger a release for this package. Any commit
touching a matching file makes the package a candidate.

## Releasing

Add a trailer to the commit that should ship:

```
fix: handle empty token lists

release: patch
```

Valid bumps: `patch`, `minor`, `major`, `skip`. The trailer decides *which
bump*; the workflow's `on:` block (push, schedule, `workflow_dispatch`)
decides *when* to ship. The scaffolded `release.yml` runs on push to `main`
and invokes `putitoutthere plan` against the trailer + changed paths, then
`putitoutthere publish` per matching package. Tags are `{name}-v{version}`
by default — set `tag_format = "v{version}"` in `putitoutthere.toml` for
single-package repos. A matching GitHub Release is cut per tag with
auto-generated notes from `git log <prev-tag>..<this-tag>`; the Release
step is best-effort and requires `GITHUB_TOKEN` (the scaffolded
`release.yml` forwards it) plus `permissions: contents: write`.

The trailer is optional. By default, any package whose `paths` matched
changed files cascades at `patch`. Use `release: minor` / `release: major`
to override the bump, or `release: skip` to suppress the release for that
commit.

## Worked example: polyglot

The reference fixture at [`test/fixtures/polyglot-everything/`](./test/fixtures/polyglot-everything/)
mirrors a real polyglot shape: a Rust crate, a PyO3 Python wheel wrapping it,
and an npm CLI bundling the Rust binary. One `putitoutthere.toml` declares
all three:

```toml
[[package]]
name = "my-tool-rust"
kind = "crates"
path = "packages/rust"
paths = ["packages/rust/**"]

[[package]]
name = "my-tool-python"
kind = "pypi"
path = "packages/python"
paths = ["packages/python/**"]
build = "maturin"
depends_on = ["my-tool-rust"]

[[package]]
name = "my-tool-cli"
kind = "npm"
path = "packages/ts"
paths = ["packages/ts/**"]
build = "bundled-cli"
depends_on = ["my-tool-rust"]
```

A change to `packages/rust/` cascades: the crate ships, and the Python + npm
wrappers ship on top (bumped to match). A change to only the TS shim ships
just the npm package.

## Library shapes

End-to-end walkthroughs — config + `release.yml` + prerequisites + gotchas —
for the common shapes. Pick the one that matches your repo:

**Single-package**

- [Python library](./docs/guide/shapes/python-library.md) — one `pyproject.toml` to PyPI
- [npm library](./docs/guide/shapes/npm-library.md) — one `package.json` to npm
- [Rust crate](./docs/guide/shapes/rust-crate.md) — one `Cargo.toml` to crates.io

**Multi-package workspaces**

- [Rust workspace](./docs/guide/shapes/rust-workspace.md) — multiple crates with `depends_on` cascade
- [npm workspace](./docs/guide/shapes/npm-workspace.md) — multiple npm packages, shared dependency graph

**Rust core, multi-registry**

- [Rust + PyO3 wheels](./docs/guide/shapes/rust-pyo3.md) — crate + PyPI (no napi)
- [Rust + napi npm](./docs/guide/shapes/rust-napi.md) — crate + npm family (no PyPI)
- [Polyglot Rust library](./docs/guide/shapes/polyglot-rust.md) — all three registries from one core
- [Python wheels with C extensions](./docs/guide/shapes/python-cibuildwheel.md) — `cibuildwheel` for the `pillow`/`lxml`/`numpy` shape

**Distribution patterns**

- [Bundled-CLI npm family](./docs/guide/shapes/bundled-cli.md) — compiled CLI shipped as an npm per-platform family
- [Dual-family npm (CLI + napi)](./docs/guide/shapes/dual-family-npm.md) — one library with both an addon and a binary

Full index at [`docs/guide/shapes/`](./docs/guide/shapes/).

## Trusted publishers

Preferred over long-lived tokens. One-time setup per registry:

- **npm:** [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) — attach the package to this repo + workflow. `--provenance` is added automatically.
- **PyPI:** [pending publisher](https://docs.pypi.org/trusted-publishers/) — register the project name pointing at this repo's `release.yml`.
- **crates.io:** [OIDC via `rust-lang/crates-io-auth-action@v1`](https://github.com/rust-lang/crates-io-auth-action) — the crate needs one manual bootstrap publish first.

Token fallbacks (`NPM_TOKEN`, `PYPI_API_TOKEN`, `CARGO_REGISTRY_TOKEN`) are
still read as env vars if OIDC isn't available. `putitoutthere doctor`
reports which path is active.

## What it is not

- Not a changelog generator. Use `git log` + conventional commits if you
  want one.
- Not a monorepo manager. Package boundaries are declared, not discovered.
- Not a dependency resolver across ecosystems. `depends_on` is about
  *cascading releases*, not runtime version pinning.
- Not a build system. Handlers shell out to `cargo`, `uv`/`maturin`/`hatch`,
  `npm` — standard toolchains only.

## Docs

- [Design proposal](./notes/4-17-2026-initial-plan/plan/proposal.md) — why this tool exists.
- [Implementation plan](./notes/4-17-2026-initial-plan/plan/plan.md) — exhaustive reference.
- [Migration guides](./migrations/) — per-repo plans for adopting putitoutthere.
- [v0 epic](https://github.com/thekevinscott/putitoutthere/issues/2) — remaining work.
