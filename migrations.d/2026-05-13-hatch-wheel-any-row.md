# Hatch wheel-any row

**Summary.** `kind = "pypi"` + `build = "hatch"` now publishes a wheel
alongside the sdist. Previously the matrix carried only a
`target = "sdist"` row, so PyPI ended up with sdist-only and downstream
`pip install` / `uvx ...` had to provision hatchling and run
`python -m build` on a cold cache — several seconds per invocation
instead of a sub-second download-and-extract. `pypa/build`'s default on
a pure-Python tree produces both an sdist and an any-platform wheel; the
planner just wasn't asking for the wheel. Issue #324.

The matrix now emits a second row per hatch package:

| Field           | Value                                |
|-----------------|--------------------------------------|
| `target`        | `any`                                |
| `artifact_name` | `<package-name>-wheel-any`           |
| `artifact_path` | `<package-path>/dist`                |
| `runs_on`       | `ubuntu-latest`                      |
| `build`         | `hatch`                              |

The reusable workflow's build step gates on
`matrix.kind == 'pypi' && matrix.build == 'hatch' && matrix.target == 'any'`
and runs `python -m build --wheel --outdir dist` (with
`SETUPTOOLS_SCM_PRETEND_VERSION` set, mirroring the sdist row's contract).

**Required changes.** None. The recommended consumer-side recipe in
[README → Quickstart](../README.md#1-drop-in-githubworkflowsreleaseyml)
already uses `actions/download-artifact@v8` with
`pattern: '*-wheel-*'` and `pattern: '*-sdist'` and feeds the combined
`dist/` to `pypa/gh-action-pypi-publish@release/v1`. Both patterns now
match for hatch packages without any consumer-side YAML change.

If you have a hand-rolled `pypi-publish` job that consumes specific
artifact names, add `<package-name>-wheel-any` to its download list.

**Deprecations removed.** None.

**Behavior changes without code changes.** Hatch packages whose previous
release shipped sdist-only will, on the first release after upgrading,
also publish an any-platform wheel to PyPI under the same version. No
new tag is created and no extra publish-time orchestration is needed —
the wheel is uploaded alongside the sdist in the existing
`pypa/gh-action-pypi-publish` step.

Scope is `build = "hatch"` only. `build = "setuptools"` stays
sdist-only and `build = "maturin"` keeps its per-target wheel rows
(both unchanged).

**Verification.** After publishing a hatch package:

```
curl -s https://pypi.org/pypi/<name>/json | jq '.urls[].packagetype'
# "sdist"
# "bdist_wheel"   ← previously absent
```

`pip install <name>` (or `uvx <name>`) should download `*.whl` and
skip the local build step entirely.

---
