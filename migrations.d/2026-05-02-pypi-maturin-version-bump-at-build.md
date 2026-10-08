# pypi/maturin version bump at build

**Summary.** `pypi` packages built with `build = "maturin"` now ship
wheels at the planned version, not at whatever literal happened to be
in `pyproject.toml` on the build runner. The reusable workflow's
build matrix (`_matrix.yml`) bumps the version source on disk to
`matrix.version` immediately before each `PyO3/maturin-action@v1`
step. Two version-source shapes are supported:

- Static literal: `[project].version = "0.1.0"` in `pyproject.toml`
  is rewritten in place. This is maturin's default project shape and
  the case that was previously broken for every consumer.
- Dynamic: `pyproject.toml` declaring `[project].dynamic = ["version"]`
  with the version sourced from a sibling `Cargo.toml`'s
  `[package].version` — that's where the bump lands instead.

Why it matters: maturin reads its version source from disk at build
time and honors no env override. Other build paths bumped elsewhere
in the contract — crates and npm at publish (`writeVersion` rewrites
the manifest before `cargo publish` / `npm publish` reads it),
setuptools-scm / hatch-vcs through `SETUPTOOLS_SCM_PRETEND_VERSION`
in the build step. Maturin had no equivalent, so wheels left the
build runner pre-versioned at the consumer's stale literal. PyPI
rejected the upload with `400 File already exists` whenever that
literal had been previously registered, even when crates and npm
shipped correctly. Hit in the wild on `dirsql`'s 0.2.8 release;
issue #276.

**Required changes.** None. The bump is internal to the reusable
workflow. Consumers pinning `release.yml@v0` and `build.yml@v0`
inherit the fix on the next workflow run with no `release.yml` edits
and no `putitoutthere.toml` edits. The fix applies equally to the
static-literal and dynamic-version shapes; consumers don't need to
restructure their pyproject to opt in.

The CLI gains a new internal subcommand,
`putitoutthere write-version --path <pkg-dir> --version <v>`, that
implements the bump dispatch. `action.yml` gains a new optional
`version:` input that the reusable workflow forwards. Both surfaces
are internal seams powering `_matrix.yml`; consumers compose with
the reusable workflow, not directly with the CLI or the JS action
(see [`notes/design-commitments.md`](../notes/design-commitments.md)
non-goal #7 and #10).

**Deprecations removed.** None.

**Behavior changes without code changes.** A maturin build run
through the reusable workflow now mutates the build runner's
`pyproject.toml` (or `Cargo.toml` for dynamic-version projects) in
place, bumping the version literal to `matrix.version`. The mutation
lives only on the build runner — the consumer's source tree is
untouched. Anyone fingerprinting on the on-disk manifest version
during a build (e.g. a custom shell step running between
`uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0`
and a follow-up step that reads the manifest) will now see the
planned version where they previously saw the consumer's stale
literal. Custom build steps that grep on a specific literal version
need to grep on `matrix.version` instead.

`pyproject.toml` projects whose `[project]` table is malformed
(neither a static `version = "..."` line nor `dynamic = ["version"]`)
now fail the build matrix with a clear error. Previously the same
shape produced wheels at whatever fallback the build backend chose,
which silently disagreed with the plan.

**Verification.** Cut a release on a maturin package whose
`pyproject.toml` carries a stale literal (e.g. `version = "0.1.0"`
when the planned version is `0.2.8`). The reusable workflow's
build matrix logs a `write-version: ... → 0.2.8` line before each
maturin invocation, and the produced wheel's `METADATA: Version:`
matches the planned version:

```sh
unzip -p dist/*.whl '*.dist-info/METADATA' | grep '^Version:'
# Version: 0.2.8
```

PyPI accepts the upload — assuming the planned version itself isn't
a duplicate of a previously-registered file.
