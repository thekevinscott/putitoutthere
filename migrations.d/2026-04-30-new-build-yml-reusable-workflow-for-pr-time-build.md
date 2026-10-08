# New `build.yml` reusable workflow for PR-time build verification

**Summary.** A second consumer-facing reusable workflow,
`.github/workflows/build.yml`, runs the same plan + build matrix that
`release.yml` runs but stops there — no publish job, no
`id-token: write`, no OIDC exchange, no registry auth. Both workflows
delegate the matrix to a shared internal `_matrix.yml`, so action
pins (`actions/checkout@v6`, `PyO3/maturin-action@v1`, etc.), per-row
build steps, and runner selection cannot drift between PR-time
verification and release-time publishing. The structural guarantee —
publish-capable bytes do not exist on the build-check code path — is
what makes this safe to run on untrusted PRs; a `dry_run: true` input
on `release.yml` would have made it a runtime guarantee subject to
GHA's expression evaluation quirks and any future `if:` bug. An
`actionlint`-job grep assertion rejects any patch that adds
`id-token: write` to `build.yml` or `_matrix.yml`.

The new workflow runs at the same `@v0` floating tag as
`release.yml`, pinned the same way the engine action already is —
floating lightweight tag, no annotated-tag pitfall ([github/community
discussion #48693](https://github.com/orgs/community/discussions/48693)).
Pinning per-release annotated tags
(e.g. `putitoutthere-v0.4.2`) is unsupported for the same reason it has
always been unsupported for `release.yml`; the `@v0` form is canonical.

**Required changes.** None for existing consumers. `release.yml` is
unchanged in its public surface — same inputs, same `has_pypi`
output, same concurrency group, same publish behavior. Internally
its `plan` and `build` jobs moved into `_matrix.yml`, but that file
is internal (the leading underscore + the absence of consumer-facing
docs); pinning `release.yml@v0` keeps working byte-for-byte.

To opt into PR-time build verification, add a new workflow to your
repo:

```yaml
# .github/workflows/build-check.yml
name: Build check
on:
  pull_request: {}
jobs:
  build-check:
    uses: thekevinscott/putitoutthere/.github/workflows/build.yml@v0
```

No new permissions, no new inputs to set. `node_version` and
`python_version` accept the same defaults / overrides as
`release.yml`. PRs that break a target-specific build (a wheel that
fails on `aarch64-apple-darwin`, an npm postinstall that fails on
Windows) now surface in review.

**Deprecations removed.** None.

**Behavior changes without code changes.** `release.yml`'s internal
job graph collapsed from `plan → build → publish` to
`build (uses: _matrix.yml) → publish`. The `publish` job now reads
`needs.build.outputs.matrix` instead of `needs.plan.outputs.matrix`;
the matrix payload is unchanged. Run logs show one nested-workflow
group (`build / plan`, `build / build`) instead of two top-level
jobs; existing log scrapers that fingerprint on the job name `plan`
need to fingerprint on `build / plan` instead.

**Verification.** On a repo that adds the build-check workflow, open
a PR that touches a `[[package]].globs` glob. The PR's Checks tab
shows a `build-check / build / build` matrix run. The job has no
`id-token: write` permission (visible in the `Show all checks` tag
on the run), and there is no `publish` job in the run's job graph.
On `main`, the existing release flow is unaffected — a tag push +
GitHub Release on the next workflow run.
