# Fixtures

Mini-repos exercising every distinct `putitoutthere` publish-path manifestation. Used by the unit plan-shape tests (`fixtures.test.ts`) and by the e2e suite (which actually publishes against the `piot-fixture-zzz-*` family on real registries).

The set is deliberately minimal: one fixture per unique manifestation. Build-backend differences that share a publish path (e.g. setuptools vs hatch) and cascade-ordering variations (covered by `polyglot-everything`) are tested at the code level, not as fixtures.

## Pure-language

One package, one publish per run.

| Path                      | Kind   | Build       | Package                                | Notes                |
|---------------------------|--------|-------------|----------------------------------------|----------------------|
| `js-vanilla/`             | npm    | vanilla     | `piot-fixture-zzz-cli`                 | Live e2e canary      |
| `python-pure-hatch/`      | pypi   | hatch       | `piot-fixture-zzz-python-hatch`        | sdist + pure wheel   |
| `python-pure-sdist-only/` | pypi   | setuptools  | `piot-fixture-zzz-python-sdist`        | sdist only, no wheel |
| `rust-crate-only/`        | crates | native      | `piot-fixture-zzz-rust-only`           | Source publish       |

## Rust-in-language

5-target matrix: linux-x64-gnu, linux-aarch64-gnu, darwin-x64, darwin-arm64, win32-x64-msvc.

| Path                   | Kind | Build        | Package                                  | Output                          |
|------------------------|------|--------------|------------------------------------------|---------------------------------|
| `python-rust-maturin/` | pypi | maturin      | `piot-fixture-zzz-python-maturin`        | 5 wheels + 1 sdist              |
| `js-napi/`             | npm  | napi         | `@putitoutthere/piot-fixture-zzz-js-napi` (+5 plat)    | 5 platform pkgs + 1 main        |
| `js-bundled-cli/`      | npm  | bundled-cli  | `@putitoutthere/piot-fixture-zzz-js-bundled` (+5 plat) | 5 platform pkgs + 1 main (shim) |

## Polyglot

| Path                   | Packages                                                                  |
|------------------------|---------------------------------------------------------------------------|
| `js-python-no-rust/`   | pypi `-python-no-rust` + npm `@putitoutthere/-js-no-rust` — SDK shape, no Rust |
| `polyglot-everything/` | crates `-rust` + pypi `-python` + npm `@putitoutthere/-cli` (bundled-cli) — dirsql shape |

`polyglot-everything/` is the v0 success criterion (plan.md §25.3 #2); it covers cross-handler interaction and `depends_on` cascade end-to-end. Single-mode polyglot variants (rust+python, rust+js-napi, rust+js-bundled) were removed: cascade ordering is pure-function logic covered by unit tests, and each underlying handler is exercised by its single-mode fixture.

## Version placeholder

Fixtures use `__VERSION__` as a substitute for their version fields. The e2e harness rewrites it at test time via `makeE2ERepo()`; plan-shape tests rewrite to `0.1.0`.
