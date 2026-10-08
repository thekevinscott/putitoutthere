# pypi `pyproject.toml` must declare `dynamic = ["version"]`

**Summary.** Every `kind = "pypi"` package's `pyproject.toml` must
now declare `[project].dynamic = ["version"]`. Static
`[project].version = "x.y.z"` literals are rejected at PR time by
`putitoutthere check` and again at publish-time preflight, both
under the stable error code `PIOT_PYPI_STATIC_VERSION`. This is
the most common Python-publishing footgun: putitoutthere does not
edit `pyproject.toml` at release time (per the [no version
computation](../notes/design-commitments.md#non-goals) design
commitment), so a literal silently shipped the previous release's
wheel/sdist because the build backend read whatever was on disk.
Making the dynamic shape mandatory closes the failure mode at the
earliest knowable boundary — the consumer's own repo state, before
a release run is ever invoked.

**Required changes.**

Before — a static literal, accepted in v0.2.x:

```toml
[project]
name = "your-package"
version = "0.1.0"
```

After — `hatch-vcs` (recommended for new packages):

```toml
[build-system]
requires = ["hatchling", "hatch-vcs"]
build-backend = "hatchling.build"

[project]
name = "your-package"
dynamic = ["version"]

[tool.hatch.version]
source = "vcs"
```

After — `setuptools-scm` (for setuptools-backed projects):

```toml
[build-system]
requires = ["setuptools>=64", "setuptools-scm>=8"]
build-backend = "setuptools.build_meta"

[project]
name = "your-package"
dynamic = ["version"]

[tool.setuptools_scm]
```

After — `maturin` (Python packages built from a Rust crate): the
version source moves to the sibling `Cargo.toml`'s
`[package].version`. `pyproject.toml` declares only that the version
is dynamic:

```toml
[build-system]
requires = ["maturin>=1"]
build-backend = "maturin"

[project]
name = "your-package"
dynamic = ["version"]
```

No reusable-workflow input changes; the existing
`SETUPTOOLS_SCM_PRETEND_VERSION` injection in the build step already
hands the planned version to `hatch-vcs` / `setuptools-scm`, and the
existing `putitoutthere write-version` step already bumps
`Cargo.toml` for the maturin path.

**Deprecations removed.**

- `pypi.writeVersion` and the `putitoutthere write-version` CLI
  subcommand no longer rewrite static literals in place — both now
  surface `PIOT_PYPI_STATIC_VERSION`. Previously they would
  silently overwrite the literal.
- The `replacePyProjectVersion` helper export and the
  "bumps BOTH pyproject and sibling Cargo.toml on the static-literal
  path" #276 carve-out are gone. Under the dynamic contract, `Cargo.toml`
  alone is the bump target on the maturin path and the pyproject literal
  has no role.

**Behavior changes without code changes.**

- `putitoutthere check` reports `PIOT_PYPI_STATIC_VERSION` against
  every pypi package whose `pyproject.toml` has a literal
  `[project].version`. Aggregated with the other preflight
  findings — one round-trip, not one error at a time.
- The publish path runs `requirePypiVersionSource` between the
  existing `requireCratesMetadata` and the artifact-completeness
  check; a misconfigured pypi tree fails fast there even if the
  PR-time `check.yml` gate was skipped.

**Verification.**

```bash
# In a repo that still declares a static version:
$ putitoutthere check
[PIOT_PYPI_STATIC_VERSION] packages/python/pyproject.toml declares a
static `[project].version` literal. Use `[project].dynamic =
["version"]` ...

# After the migration above:
$ putitoutthere check
# (no findings, exits 0)
```

Tracked at #333.

---
