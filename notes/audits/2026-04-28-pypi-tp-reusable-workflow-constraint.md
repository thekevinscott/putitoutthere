# PyPI Trusted Publisher constraint for reusable workflows

**Date:** 2026-04-28.
**Status:** confirmed; architectural mitigation landed in this audit's
companion commit.

## TL;DR

PyPI's Trusted Publisher (TP) feature does not currently support OIDC
tokens minted from inside cross-repo reusable workflows. Tokens minted
by `thekevinscott/putitoutthere/.github/workflows/release.yml`
running on behalf of a consumer (e.g., `thekevinscott/coaxer`) carry
mismatched claims that PyPI's matcher filters out before the
workflow-ref check. PyPI explicitly documents this limitation and
tracks the eventual fix at
[`pypi/warehouse#11096`](https://github.com/pypi/warehouse/issues/11096),
no timeline (volunteer-funded).

To preserve OIDC trusted publishing for PyPI without forcing
consumers onto `PYPI_API_TOKEN`, this codebase moves the PyPI upload
step out of the reusable workflow and into the consumer's own
workflow file as a `pypi-publish` job that runs
`pypa/gh-action-pypi-publish` against artifacts the reusable workflow
produced.

## Diagnosis

The OIDC token GitHub mints inside a job carries (among others) two
relevant claims:

- `repository`: `<owner>/<name>` of the **calling** workflow's repo.
  Per
  [GitHub's OIDC-with-reusable-workflows docs](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/using-openid-connect-with-reusable-workflows),
  this is always the caller's repo, even when the job is defined in a
  reusable workflow from another repo.
- `job_workflow_ref`: path of the workflow file that contains the
  *executing job*, e.g. `<owner>/<repo>/.github/workflows/release.yml@<ref>`.
  When the executing job lives in a reusable workflow, this points at
  the reusable workflow's repo.

For a consumer (`thekevinscott/coaxer`) calling
`thekevinscott/putitoutthere/.github/workflows/release.yml`, an OIDC
token minted from the publish job carries:

```
repository       = thekevinscott/coaxer
job_workflow_ref = thekevinscott/putitoutthere/.github/workflows/release.yml@<ref>
```

PyPI's TP lookup is in
[`warehouse/oidc/models/github.py:GitHubPublisherMixin.lookup_by_claims`](https://github.com/pypi/warehouse/blob/main/warehouse/oidc/models/github.py):

```python
query: Query = Query(cls).filter_by(
    repository_name=repository_name,
    repository_owner=repository_owner,
    repository_owner_id=signed_claims["repository_owner_id"],
    workflow_filename=job_workflow_filename,
)
```

All four columns are conjoined in a single `filter_by`. `repository_name`
and `repository_owner` come from the `repository` claim. So a TP
registered with:

```
Owner:     thekevinscott
Repo:      putitoutthere
Workflow:  release.yml
```

…is filtered out at the first stage (the consumer's `repository`
claim is `coaxer`, not `putitoutthere`). The
`workflow_filename=release.yml` check never fires. The mint exchange
returns 422 `invalid-publisher` with `expecting one of [...]` listing
TPs registered against the consumer's repo (which exist but were
themselves intended to match a workflow file in *the consumer's* repo,
not the reusable one).

## Verification

Confirmed against:

1. The Warehouse source linked above (read 2026-04-28).
2. PyPI's published troubleshooting:
   ["Reusable workflows cannot currently be used as the workflow in a
   Trusted Publisher."](https://docs.pypi.org/trusted-publishers/troubleshooting/)
3. `webknjaz`'s position on `pypa/gh-action-pypi-publish` (the
   maintainer): explicitly unsupported configuration; "Until PyPI
   implements support, there's no point in wasting time on hacks."
   ([gh-action-pypi-publish#166](https://github.com/pypa/gh-action-pypi-publish/issues/166))
4. Real production failures in `thekevinscott/coaxer`'s release runs.

## Options considered

1. **PYPI_API_TOKEN fallback.** Off the table — drops the OIDC-only
   posture which is a stated design commitment.
2. **Pass minted token between jobs.** Impossible — OIDC tokens are
   per-job, non-portable, and claims are baked at mint time.
3. **Caller-side composite action we ship** (`putitoutthere/publish-pypi@v0`
   wrapping `pypa/gh-action-pypi-publish`). Webknjaz states invoking
   `pypa/gh-action-pypi-publish` from inside a composite action is
   separately unsupported; risk of breakage. Also conflicts with
   non-goal #10 (no step-level GitHub Action surface as a consumer
   integration point).
4. **Wait for `warehouse#11096`.** No timeline; not a plan.
5. **Caller-side documented recipe** (chosen). Consumer pastes a
   `pypi-publish` job into their `release.yml` that runs
   `pypa/gh-action-pypi-publish` directly. PyPA's recommended
   pattern. Loosely coupled — when `warehouse#11096` ships, we can
   flip to native TP support cleanly.

## Decision and rationale

**Chosen: option 5 — caller-side documented recipe.** Reasoning:

- We own no new code surface (no composite action to maintain).
- Risk transfers to `pypa/gh-action-pypi-publish`, a PSF-funded
  project that ships PEP 740 attestations natively.
- `pypa/gh-action-pypi-publish` runs as a top-level step in the
  caller's job — exactly the supported configuration.
- Aligns with `webknjaz`'s explicitly endorsed pattern for
  reusable-workflow integrations.
- Reversible. We can ship a thin composite later if consumer demand
  justifies it, without breaking this pattern.

**Cost:** consumer's `release.yml` grows from ~12 → ~30 lines. The
pypi-publish job is gated on the new `has_pypi` workflow_call output
so non-PyPI repos paste it once and it never executes for them. The
template remains a single canonical block — no "if you publish to PyPI,
also paste this" decision point for consumers.

## Implementation summary

- `src/handlers/pypi.ts`: `publish()` no longer uploads. Returns
  `{ status: 'published' }` so `publish.ts` creates+pushes the git
  tag. The `mintOidcToken` helper, `renderAuthFailure`, and the
  `PIOT_AUTH_OIDC_*` error codes are deleted as dead code (~270
  lines of handler code + ~33 unit tests removed).
- `.github/workflows/release.yml`: `publish` job no longer installs
  `setup-python` or `twine`. New `has_pypi` workflow_call output
  computed in the `plan` job from the matrix.
- `.github/workflows/e2e-fixture.yml`: mirrors the same shape and
  adds a caller-side `pypi-publish` job for PyPI fixtures.
- `README.md` Quickstart: canonical template includes the
  `pypi-publish` job. "Trusted publishers" section documents that
  TPs are registered against the consumer's own repo and explains
  why.
- `test/fixtures/*/.github/workflows/release.yml`: all 9 fixtures
  carry the same canonical template.
- `CHANGELOG.md` / `MIGRATIONS.md`: BREAKING entry with before/after
  diff for consumers.

## Open questions / follow-ups

- **`warehouse#11096` lands.** When it does, the engine can flip back
  to in-reusable-workflow PyPI uploads cleanly. The new code paths
  to add are obvious (re-mint OIDC inside `pypi.ts`), and the
  caller-side `pypi-publish` job becomes optional. Plan: when 11096
  ships, ship a v1 of the reusable workflow that supports both
  shapes; deprecate the caller-side job in v2.
- **Multi-package PyPI consumers.** A single `pypa/gh-action-pypi-publish`
  step uploads everything in `dist/`. PyPI's OIDC mint is per-project,
  so the action mints separately for each file. Untested for our
  multi-pypi-package fixtures; verify in CI.
- **Attestations.** `pypa/gh-action-pypi-publish` defaults to
  generating PEP 740 attestations. Should work in the caller-side
  pattern; if it doesn't, we'll see in CI.
