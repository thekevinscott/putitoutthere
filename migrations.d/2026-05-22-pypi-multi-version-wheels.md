# pypi multi-version wheels

**Summary.** `kind = "pypi"` packages now build a wheel for every
CPython version they support, instead of a single wheel for the
`python_version` workflow input. The version set is resolved per
package: an explicit `python_versions` array in `putitoutthere.toml`
wins; otherwise it is inferred from `[project].requires-python` in the
package's `pyproject.toml`; otherwise a single default (`3.12`) is
used. The build matrix fans `maturin` per-target wheel rows across the
resolved set. This closes the incomplete-coverage bug where a package
declaring `requires-python = ">=3.10"` shipped a cp312-only wheel and
failed to install on every other interpreter.

**Required changes.** None for the default path — `requires-python`
inference is automatic. Optionally pin a subset:

| Before | After |
|--------|-------|
| _(no knob; one wheel at `python_version`)_ | `python_versions = ["3.12", "3.13"]` under a `[[package]]` with `kind = "pypi"` |

Consumers whose caller-side `pypi-publish` job collects wheels from the
downloaded artifacts directory need no change as long as it globs all
wheel artifacts (the recommended recipe already does); multi-version
`maturin` wheel artifacts are now named
`<pkg>-wheel-<triple>-py<ver>` rather than `<pkg>-wheel-<triple>`. A
single planned version keeps the unsuffixed name.

**Deprecations removed.** None. The `python_version` input on
`release.yml`, `build.yml`, and `_matrix.yml` is now deprecated — it no
longer affects pypi builds — but is retained so existing callers do not
break. Remove it from your `with:` block at leisure.

**Behavior changes without code changes.** A pypi package whose
`requires-python` spans multiple versions now produces multiple wheels
where it previously produced one. The `python_version` workflow input
is inert for pypi builds.

**Verification.** Push a release for a `kind = "pypi"` package whose
`pyproject.toml` declares `requires-python = ">=3.11"`; the build job
fans into one wheel row per released version (for example `3.11`,
`3.12`, `3.13`, `3.14`), and the
published PyPI release carries a wheel for each.
