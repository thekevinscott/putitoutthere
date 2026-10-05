# `bundle_cli` wheel guard respects `python-source`

**Summary.** Maturin's standard mixed-project layout
(`maturin new --mixed` generates `[tool.maturin].python-source = "python"`)
declares a package source root that maturin strips from on-disk paths
when rewriting them into the wheel's distribution layout. A binary
staged on disk at `<pkg.path>/<stage_to>/<bin>` — e.g.
`packages/python/python/dirsql/_binary/dirsql` — ends up in the wheel
at `dirsql/_binary/dirsql`, with `python/` stripped. The reusable
workflow's `bundle_cli` wheel-content guard previously asserted a
literal `<stage_to>/<bin>` suffix inside the produced wheel; the regex
never matched the stripped path, so the guard fired red on every
per-target build row even when the binary was correctly bundled.

The guard now reads `[tool.maturin].python-source` (and the legacy
`python_source` spelling — both forms are accepted by maturin across
versions) from `<matrix.path>/pyproject.toml` and subtracts that
prefix from `stage_to` before constructing the suffix regex. Consumers
with an implicit-root layout (no `python-source` key, or an empty
value) keep the previous behavior byte-for-byte; consumers with the
explicit-root layout start passing the guard. Tracked at #338.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- For a consumer with `[tool.maturin].python-source = "python"` and
  `[package.bundle_cli].stage_to = "python/dirsql/_binary"`, the
  reusable workflow's wheel-content guard now resolves the in-wheel
  suffix to `dirsql/_binary/<bin>` (matching what maturin actually
  produces) instead of asserting the unstripped `python/dirsql/_binary/<bin>`.
- A `python-source` value that isn't actually a prefix of `stage_to`
  is left alone — the guard reverts to asserting the unstripped
  `stage_to` so the consumer's misconfiguration surfaces with the same
  diagnostic it does today.
- An unset or empty `python-source` value resolves to the empty
  string and `stage_suffix` is unchanged. No behavior change for
  consumers who don't use the explicit-root layout.

**Verification.** With a maturin package whose `pyproject.toml`
declares `[tool.maturin].python-source = "python"` and whose
`[package.bundle_cli]` sets `stage_to = "python/<pkg>/_binary"`,
a release run should produce wheels whose `unzip -l` listing contains
`<pkg>/_binary/<bin>` and the wheel-content guard step should log
`ok bundle_cli: <pkg>/_binary/<bin> present in <wheel>`.
