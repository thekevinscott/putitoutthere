# `check` rejects a Python version source no release step rewrites

**Summary.** `[project].dynamic = ["version"]` was treated as sufficient
on its own: preflight checked only that *some* version table existed
(`[tool.hatch.version]` or `[tool.setuptools_scm]`). Two shapes passed
that check and then published the previous release's version. Plain
hatchling with `[tool.hatch.version] path = "src/<pkg>/_version.py"`
(and its `source = "code"` sibling) reads a literal out of a file in the
tree — a file no release step rewrites, read by a source that ignores
the `SETUPTOOLS_SCM_PRETEND_VERSION` the reusable workflow exports — so
the wheel ships what is committed. `agent-transcript-viewer` uploaded
`0.0.0` to PyPI that way while the plan said `0.1.0`, with every check
green and no way to re-upload the version afterwards. Separately, a
version table whose plugin is missing from `[build-system].requires`
(`source = "vcs"` without `hatch-vcs`, or `[tool.setuptools_scm]`
without `setuptools-scm`) fails *during* the build, mid-release. Both
are now caught at PR time: the file-path shape as the new
`PIOT_PYPI_HATCH_VERSION_PATH`, the missing plugin as the widened
`PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND`. They are separate codes because
the remedies differ — switch the source, versus declare the plugin.
#696.

**Required changes.** Only if your `pyproject.toml` is on one of the
rejected shapes. `build = "maturin"` packages need no changes (their
version comes from the sibling `Cargo.toml`, which the release path
bumps).

| Situation | Before | After |
| --- | --- | --- |
| hatchling, version read from a file | `[tool.hatch.version]`<br>`path = "src/pkg/_version.py"` | `[tool.hatch.version]`<br>`source = "vcs"`<br>and `"hatch-vcs"` in `[build-system].requires` |
| hatch-vcs source declared, plugin not | `requires = ["hatchling"]` | `requires = ["hatchling", "hatch-vcs"]` |
| setuptools-scm configured, plugin not | `requires = ["setuptools"]` | `requires = ["setuptools", "setuptools-scm"]` |

The `_version.py` the old shape read is no longer needed; delete it (or
leave it — nothing reads it once `source = "vcs"` is set).

**Deprecations removed.** None.

**Behavior changes without code changes.**

| Situation | Before | After |
| --- | --- | --- |
| `[tool.hatch.version] path = "..."` | `check` passed; the release published the committed literal | `check` fails with `PIOT_PYPI_HATCH_VERSION_PATH`; publish-time preflight refuses too |
| `[tool.hatch.version] source = "code"` | same as above | same as above |
| `source = "vcs"`, `hatch-vcs` absent from `requires` | `check` passed; the build failed mid-release with `Unknown version source: vcs` | `check` fails with `PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND` |
| `[tool.setuptools_scm]`, `setuptools-scm` absent from `requires` | `check` passed; the build produced no version | `check` fails with `PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND` |
| `[[tool.hatch.version]]` / `[[tool.setuptools_scm]]` (array-of-tables typo) | `check` passed — the presence test accepted any non-null object, arrays included | `check` fails with `PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND` |
| `source = "vcs"` with `hatch-vcs` declared | passed | passed, unchanged |
| `[tool.setuptools_scm]` with `setuptools-scm` declared | passed | passed, unchanged |
| `build = "maturin"` | passed | passed, unchanged |

Plugin names are compared after PEP 503 normalisation and with version
specifiers, extras, and environment markers stripped, so
`setuptools_scm>=8`, `setuptools-scm[toml]>=8`, `Setuptools-SCM`, and
`hatch-vcs ; python_version < '3.9'` all count as declared.

**Verification.** Run `putitoutthere check` in your repo (or let
`check.yml` run it on a PR). A package on a rejected shape prints the
code and the offending path, for example:

```
[PIOT_PYPI_HATCH_VERSION_PATH] packages/py/pyproject.toml: [tool.hatch.version] resolves the version from a file in the tree ... Declared path: "src/pkg/_version.py"
```

After switching to `source = "vcs"` with `hatch-vcs` in
`[build-system].requires`, `check` reports `check: no findings` and the
next release's wheel carries the planned version — confirm with
`python -c "import importlib.metadata as m; print(m.version('<pkg>'))"`
after installing it, or by reading the `Version:` line of the wheel's
`*.dist-info/METADATA`.

---
