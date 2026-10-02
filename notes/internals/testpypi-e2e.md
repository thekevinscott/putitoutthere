# TestPyPI e2e fixture setup

Issue #295 adds a TestPyPI publish-and-verify path to
`.github/workflows/e2e-fixture.yml`. The workflow publishes the built Python
fixture artifacts to TestPyPI, then downloads the wheel and sdist back from
`https://test.pypi.org/simple/` and checks their embedded metadata versions.

## Trusted Publisher registrations

Register these TestPyPI projects with Trusted Publishing:

| TestPyPI project | GitHub owner | Repository | Workflow | Environment |
| --- | --- | --- | --- | --- |
| `piot-fixture-zzz-python-maturin` | `thekevinscott` | `putitoutthere` | `e2e-fixture.yml` | `e2e` |
| `piot-fixture-zzz-python-hatch` | `thekevinscott` | `putitoutthere` | `e2e-fixture.yml` | `e2e` |

Use the same TestPyPI account that owns the fixture projects. The workflow uses
`pypa/gh-action-pypi-publish@release/v1` with
`repository-url: https://test.pypi.org/legacy/`, so no long-lived TestPyPI API
token should be stored in GitHub secrets.

## Why this is separate from real PyPI

The steady-state `pypi-publish` job uploads all non-first-publish Python
artifacts to production PyPI. The TestPyPI job only targets
`python-rust-maturin` and `python-pure-hatch`.

Both jobs now upload with `skip-existing: true`. The TestPyPI job originally
omitted it so a duplicate upload would 400 — an incidental canary for the
fixture version regressing to the `0.0.1` build-mode literal instead of the
plan-computed `0.0.<epoch>`. #669 removed the omission: the job uploads and then
polls `/simple/`, and when that poll times out (#668) the artifacts are already
up, so `gh run rerun --failed` re-uploaded byte-identical files and died on the
400 before reaching the step that actually failed. Recovery cost a full ~100-job
E2E re-run.

That canary was traded for re-runnability, and #672 replaced it in code. A stale
`0.0.1` now skips silently at the registry, and the metadata verify reads back
the previous run's artifacts and finds exactly the version it expected — so the
check moved earlier, to `piot-ci testpypi-verify assert`, which runs *before*
the upload and never consults the registry at all. It collects each fixture's
version from its own artifact filenames (sharing `buildRequirements` with the
metadata step so the two can never disagree), demands one version per project,
and demands that version look like one the plan phase stamped: `0.0.<digits>`
and not the `0.0.1` build-mode baseline (`isPlanFixtureVersion`).

Shape, not equality, because `FIXTURE_VERSION` is not reachable from the
caller's `testpypi-publish` job: each fixture's version is computed inside its
own `e2e-fixture-job.yml` instance's `plan` job, so the two TestPyPI fixtures
carry different values in one run; the reusable workflow declares no
`workflow_call` outputs, matrixed reusable-workflow outputs are last-writer-wins
anyway, `$GITHUB_ENV` does not cross jobs, and the artifact names carry no
version. Provenance shape is what the publish job can check on its own, and it
catches both the documented `0.0.1` regression and a fresh-looking version from
the wrong source (hatch-vcs' `0.1.dev1+g<sha>` when
`SETUPTOOLS_SCM_PRETEND_VERSION` goes missing). For `python-pure-hatch` it is
the only version guard in the graph — the maturin rows also get the build job's
`putitoutthere verify wheel --version`, the hatch rows get nothing else.
