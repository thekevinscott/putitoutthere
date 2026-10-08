# New `check.yml` reusable workflow for PR-time config sanity

**Summary.** `putitoutthere` now ships a third reusable workflow,
`.github/workflows/check.yml`, that drives the engine's `check`
subcommand at PR time. The subcommand aggregates every pre-merge
check (`putitoutthere.toml` parse + schema, common-mistakes
detector, unique-name guard, `depends_on` cycle / dangling-ref
detection, `[[package]].path` existence, `globs` matching a
tracked file, `tag_format` collisions, npm `repository` field,
crates `description` / `license`, pypi `pyproject.toml` +
`bundle_cli` binary declaration, npm target triple mapping)
and reports findings in one round-trip. Where `release.yml` is
the release-time phase and `build.yml` is the heavier per-target
build gate, `check.yml` is the cheap config-sanity gate — a few
seconds per PR, no `setup-python` / `setup-rust`, no per-target
compile. Shipped per the "no release surprises" goal added in
#316: anything checkable from the consumer's repo state alone
surfaces at PR time, not at release time. Issue #317 (workflow
shell) + issue #319 (check list, shipped via #321).

**Required changes.** Additive. Existing consumers do nothing.
Recommended: add a one-line PR-CI workflow.

```yaml
# .github/workflows/check.yml  ←  new file in your repo, optional
name: putitoutthere check

on:
  pull_request: {}

jobs:
  putitoutthere-check:
    uses: thekevinscott/putitoutthere/.github/workflows/check.yml@v0
```

The new workflow accepts no `with:` inputs, no `secrets:`, no
`permissions:` requirements beyond the default `contents: read` it
sets internally. The integration line is the entire surface.

**Deprecations removed.** None.

**Behavior changes without code changes.** None. Existing release
runs are unaffected — the new workflow is opt-in PR-time CI; the
release path is unchanged.

**Verification.** Open a PR that introduces a typo in
`putitoutthere.toml` (e.g. `[[packages]]` instead of `[[package]]`).
Without `check.yml` wired, the failure surfaces at release time
in a red `plan` step. With `check.yml` wired, the PR fails red at
review time with the same diagnosable error message, before the
merge.
