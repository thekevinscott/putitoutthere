# pypi version-independent wheels build once

**Summary.** A `kind = "pypi"` `build = "maturin"` package whose wheel is
Python-version-independent — `[tool.maturin].bindings = "bin"` (a
Rust-binary `py3-none` wheel) or a pyo3 `abi3` / `abi3-pyXY` extension (a
`cp3x-abi3` stable-ABI wheel) — used to be built once per CPython version
in the resolved set (inferred from `[project].requires-python`, or pinned
via `python_versions`). Because such a wheel is byte-identical no matter
which interpreter built it, the fan produced N duplicate wheels, and the
documented `pypi-publish` recipe's `merge-multiple: true` download then
race-corrupted the identical wheel filenames extracted onto one path
(`twine check` → `zipfile.BadZipFile`). The planner now collapses the fan
to a single wheel per target for these packages.

**Required changes.** None. Detection is automatic from your existing
`pyproject.toml` / `Cargo.toml`; no `putitoutthere.toml`, `release:`
trailer, or reusable-workflow input changes. The consumer `pypi-publish`
job is unchanged — its `pattern: '*-wheel-*'` still matches the (now
single) wheel artifact.

**Deprecations removed.** None.

**Behavior changes without code changes.** For a version-independent
maturin wheel resolving to more than one CPython version:

| | Before | After |
|---|--------|-------|
| Wheel build rows per target | one per resolved version (e.g. 6 for `>=3.9`) | one |
| Wheel artifact name | `<pkg>-wheel-<triple>-py<ver>` (per version) | `<pkg>-wheel-<triple>` (unsuffixed) |
| Build interpreter | each resolved version | newest resolved version only |

Ordinary per-version extension modules (no abi3, no `bindings = "bin"`)
are unaffected — they still fan and keep their `-py<ver>` suffixes. The
sdist row is unchanged. Detection is conservative: an abi3 setup the
engine doesn't recognize (a workspace-inherited `pyo3` dependency, a
`[target.'cfg(...)'.dependencies]` table) falls back to the prior fanning
behavior.

**Verification.** Run `putitoutthere plan` (or release) a maturin package
with `bindings = "bin"` or a pyo3 `abi3` feature and a `requires-python`
spanning multiple minors. The build matrix now shows a single
`<pkg>-wheel-<triple>` artifact per target instead of one per version, and
the `pypi-publish` job's `twine check` no longer fails with `BadZipFile`.
