# E2E

End-to-end tests live entirely in CI; there is no local harness. The point of these tests is to **mirror what an external library experiences** — a consumer writes a 5-line `release.yml` that calls our reusable workflow, and the same `plan → build → publish` flow runs against their working tree, end-to-end against real registries via OIDC.

## How it runs

`.github/workflows/e2e.yml` is a thin matrix over the 9 fixtures under `test/fixtures/`. Each matrix entry calls `.github/workflows/e2e-fixture.yml`, which mirrors `release.yml`'s job graph step-for-step (same `actions/setup-python@v5`, same `PyO3/maturin-action@v1`, same `actions/upload-artifact@v4` / `download-artifact@v4`, same engine action). The only difference: a "Materialize fixture" step that copies `test/fixtures/${fixture}/` into a `fixture-tree/` subdirectory at workflow start, bumps `__VERSION__` placeholders to a throwaway `0.0.{unix_seconds}` version, and points each step at that subdirectory via `working_directory:`.

The job's pass/fail **is** the assertion. There is no vitest, no harness, no per-fixture test file — if every step the reusable workflow runs against this fixture passes against real registries, the matrix entry is green.

## Auth

OIDC trusted publishing only. The `e2e` GitHub Actions environment grants `id-token: write`; the engine mints OIDC tokens for npm / twine / cargo as needed. **No long-lived registry tokens** in the e2e flow — that matches what the public reusable workflow does.

A fixture's job stays red until trusted publishers are registered (`piot-fixture-zzz-*` for the package names that fixture publishes). That is by design: the failure is the signal that a publisher still needs to be wired (#244 step 2).

## Versioning

Each run uses `0.0.{unix_seconds}`. Monotonically increasing, doesn't collide with human-authored versions, and crates.io's immutable-publish rule isn't blocking. The plan job bakes the version once and the build / publish jobs each re-materialize from the fixture using the same value.

## Why not run locally

Local runs can't get OIDC; the only auth path the suite exercises is OIDC trusted publishing. There's nothing meaningful to run locally beyond what unit + integration tests already cover. If you need to debug an e2e failure, dispatch the `E2E` workflow on your branch and read the job logs.

## Fixture coverage

| Fixture                  | Manifestation                                                 |
|--------------------------|---------------------------------------------------------------|
| `js-vanilla`             | npm OIDC + plain `npm publish`                                |
| `js-napi`                | napi platform-family synthesis + `optionalDependencies` rewrite |
| `js-bundled-cli`         | bundled-cli launcher + per-target binaries                    |
| `js-python-no-rust`      | npm + pypi side-by-side, no Rust (SDK shape)                  |
| `python-pure-hatch`      | hatch backend + twine OIDC mint-token                         |
| `python-pure-sdist-only` | sdist-only path (no wheel)                                    |
| `python-rust-maturin`    | per-target maturin wheels + sdist                             |
| `polyglot-everything`    | rust + python (maturin) + multi-mode npm (bundled-cli + napi) cascade end-to-end |
