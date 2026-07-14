# E2E

putitoutthere has **two** e2e mechanisms, both run in CI:

- **Fixture suite** (`e2e.yml` → `e2e-fixture.yml`, over `tests/fixtures/`) — the heavy path documented below. Real OIDC publishes; the job is the assertion; can't run locally (no OIDC).
- **CLI e2e** (`tests/e2e/*.e2e.test.ts`, `pnpm test:e2e`, `e2e-cli.yml`) — vitest tests that shell out to the built CLI (`node dist/cli-bin.js …`) and hit the real registries for read-mostly behaviours that need no publish: `status` (a registry read) and the publish-path auto-heal (the already-published skip path, which never publishes). Pointed at piot's own stable `piot-fixture-zzz-*` packages, so it's reliable in CI; runs locally too (`pnpm test:e2e`, which builds `dist/` first).

The rest of this doc covers the **fixture suite**. Its point is to **mirror what an external library experiences** — a consumer writes a 5-line `release.yml` that calls our reusable workflow, and the same `plan → build → publish` flow runs against their working tree, end-to-end against real registries via OIDC.

## How it runs

`.github/workflows/e2e.yml` is a thin matrix over the 9 fixtures under `tests/fixtures/`. Each matrix entry calls `.github/workflows/e2e-fixture.yml`, which mirrors `release.yml`'s job graph step-for-step (same `actions/setup-python@v5`, same `PyO3/maturin-action@v1`, same `actions/upload-artifact@v4` / `download-artifact@v4`, same engine action). The only difference: a "Materialize fixture" step that copies `tests/fixtures/${fixture}/` into a `fixture-tree/` subdirectory at workflow start, bumps `__VERSION__` placeholders to a throwaway `0.0.{unix_seconds}` version, and points each step at that subdirectory via `working_directory:`.

The fixture suite's job pass/fail **is** the assertion — no per-fixture test file (the CLI e2e above is the vitest path). If every step the reusable workflow runs against this fixture passes against real registries, the matrix entry is green.

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
