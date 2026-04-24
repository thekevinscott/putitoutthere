# Library shapes

Worked end-to-end examples, one per common library shape. Each page
walks through the `putitoutthere.toml`, the `release.yml`, the
publish-job prerequisites, and the gotchas specific to that shape.

Pick the one that matches your repo. If none quite fit, the closest
shape plus [Configuration](/guide/configuration) should cover it.

## Single-package shapes

One manifest, one registry. Pick the one that matches your
package manager.

- [**Single-package Python library**](/guide/shapes/python-library) —
  one `pyproject.toml`, publishing to PyPI. Covers both
  static-version (literal `version = "…"`) and dynamic-version
  (`hatch-vcs` / `setuptools-scm`) setups.
- [**Single-package npm library**](/guide/shapes/npm-library) —
  one `package.json`, publishing to npm. Pure JS/TS, no native
  addon, no bundled CLI.
- [**Single-package Rust crate**](/guide/shapes/rust-crate) —
  one `Cargo.toml`, publishing to crates.io. No PyO3, no napi.

## Multi-package workspaces

Many packages from one repo. piot doesn't auto-discover them —
declare each one explicitly — but it does orchestrate cascade,
topological order, and per-package publishing.

- [**Multi-crate Rust workspace**](/guide/shapes/rust-workspace) —
  multiple crates to crates.io with `depends_on`-driven cascade.
- [**Multi-package npm workspace**](/guide/shapes/npm-workspace) —
  multiple npm packages from one workspace, sharing a
  dependency graph.

## Rust core, multiple registries

One Rust crate feeds multiple artifacts on multiple registries.

- [**Rust + PyO3 wheels**](/guide/shapes/rust-pyo3) — crate on
  crates.io + PyO3 wheels on PyPI via `maturin`, no napi.
  Subset of the polyglot shape.
- [**Python wheels with C/C++ extensions**](/guide/shapes/python-cibuildwheel) —
  `setuptools` or `hatch` + `cibuildwheel` for the
  `pillow` / `lxml` / `numpy` shape (C/C++/Cython, not Rust).
- [**Rust + napi npm**](/guide/shapes/rust-napi) — crate on
  crates.io + napi-rs family on npm, no PyPI. The inverse.
- [**Polyglot Rust library**](/guide/shapes/polyglot-rust) — the
  full shape: crate + PyO3 wheels + napi family, all three
  registries from one core.

## Distribution-only shapes

Specific distribution patterns piot supports, independent of
source language.

- [**Bundled-CLI npm family**](/guide/shapes/bundled-cli) — a
  compiled CLI (Rust, Go, whatever) published as an npm
  per-platform family so `npm install -g my-tool` gives users a
  binary on PATH. The esbuild / biome distribution shape.
- [**Dual-family npm (CLI + napi)**](/guide/shapes/dual-family-npm) —
  when one conceptual library needs both a napi addon *and* a
  CLI binary. piot doesn't support merging the two under one
  top-level; this page documents the split-package workaround.

## Not covered here (yet)

If your shape isn't listed, start with [Concepts](/guide/concepts) for
what piot does and doesn't cover, then
[Configuration](/guide/configuration) for the `[[package]]` grammar.
[Known gaps](/guide/gaps) enumerates the shapes piot deliberately
won't absorb (so you can rule them out early).

Want a shape added? Open an issue with your `putitoutthere.toml` and
`release.yml`; it's the fastest path to a new page.
