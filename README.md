# Put It Out There

Polyglot release orchestrator for single-maintainer, LLM-authored projects
that publish to crates.io, PyPI, and npm from one monorepo. One config file,
one CLI, one trailer-driven signal — no per-package release plumbing.

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

Valid bumps: `patch`, `minor`, `major`, `skip`. On push to `main`, the
`release.yml` workflow runs `putitoutthere plan` against the trailer +
changed paths, then `putitoutthere publish` per matching package. Tags are
`{name}-v{version}`.

No trailer → no release, even if code changed. That's the point.

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
- [v0 epic](https://github.com/thekevinscott/put-it-out-there/issues/2) — remaining work.
