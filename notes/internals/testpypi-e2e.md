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

That canary was traded for re-runnability and has not yet been replaced (#672).
A stale `0.0.1` now skips silently, and the metadata verify then reads back the
previous run's artifacts and finds the version it expected. The replacement
belongs in `piot-ci testpypi-verify assert` as an explicit check that the
artifact filenames carry `FIXTURE_VERSION`, not in twine's duplicate handling.
