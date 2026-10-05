# Single-artifact publish layout normalization

**Summary.** The reusable workflow's publish job downloads build
artifacts with `actions/download-artifact@v8` configured as `path:
artifacts` and no `name`/`pattern` filter. That action is
count-sensitive: multiple artifacts land in `artifacts/<name>/...`
subdirs (the documented multi-case the engine's completeness check
and every handler are written against), but a *single* artifact
extracts directly into `artifacts/` with no per-artifact subdir.
Consumers whose plan emits exactly one expected artifact — pure-Python
packages with `build = "hatch"` (sdist row only) being the canonical
case — therefore failed at the completeness check with `missing
artifact directory <pkg>-sdist/` before the pypi handler ever ran.
Multi-artifact consumers (pypi+npm, sdist+wheels, polyglot) were
unaffected. The publish job now normalizes the layout in-process
before completeness: when the plan expects one staged artifact and
`artifacts/<artifact_name>/` is absent, files in `artifacts/` are
moved into that subdir so the engine's contract holds. Fully a
fix-in-place; no input shape, output shape, or config key changed.
Tracked in #311.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- Pypi-only consumers with `build = "hatch"` (or any other
  `[[package]]` whose plan emits a single artifact row) that
  previously failed publish with `Artifact completeness check
  failed: ... missing artifact directory <pkg>-sdist/` now reach the
  pypi handler successfully and tag as expected. The wider release
  flow — version-rewrite, tag creation, GitHub Release, caller-side
  `pypi-publish` upload — was already correct; only the engine's
  pre-publish completeness check was upstream of the bug.
- Multi-artifact plans (≥2 staged artifacts), crates-only plans, and
  vanilla-npm plans (`[[package]] kind = "npm"` with no `build` /
  `build = []`) see no observable difference. The normalization is
  scoped to the exact case `download-artifact@v8` dumps into the
  root.

**Verification.** A release-please / release-plz cascade against a
pure-Python `[[package]]` with `build = "hatch"` should:

1. Surface the planned matrix as a single row,
   `target = sdist artifact = <pkg>-sdist`.
2. Reach the `pypi: <pkg>@<version> delegated to caller-side upload
   step.` log line in the publish job.
3. Push a `<pkg>-v<version>` tag, kick off the caller's
   `pypi-publish` job, and produce a GitHub Release. No
   `missing artifact directory` error appears in the run log.
