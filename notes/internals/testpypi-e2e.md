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

The steady-state `pypi-publish` job still uploads all non-first-publish Python
artifacts to production PyPI with `skip-existing: true`. The TestPyPI job only
targets `python-rust-maturin` and `python-pure-hatch`, and intentionally does
not use `skip-existing`. If the build regresses to a stale literal version,
TestPyPI should reject the duplicate file instead of masking the failure.
