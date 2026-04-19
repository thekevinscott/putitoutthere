# Fixtures

Mini-repos exercising every `putitoutthere` shape end-to-end. Used by the unit golden tests (snapshotting `putitoutthere plan --json` output) and by the E2E suite (which actually publishes against the `piot-fixture-zzz-*` family).

## Pure-language (#29)

No build matrix. One package, one publish per run.

| Path                           | Kind   | Build       | Notes                       |
|--------------------------------|--------|-------------|-----------------------------|
| `rust-crate-only/`             | crates | native      | Source publish to crates.io |
| `python-pure-setuptools/`      | pypi   | setuptools  | sdist + pure wheel          |
| `python-pure-hatch/`           | pypi   | hatch       | sdist + pure wheel          |
| `python-pure-sdist-only/`      | pypi   | setuptools  | sdist only                  |
| `js-vanilla/`                  | npm    | vanilla     | One `npm publish` run       |

## Rust-in-language (#30)

5-target matrix: linux-x64-gnu, linux-aarch64-gnu, darwin-x64, darwin-arm64, win32-x64-msvc.

| Path                      | Kind | Build        | Output                          |
|---------------------------|------|--------------|---------------------------------|
| `python-rust-maturin/`    | pypi | maturin      | 5 wheels + 1 sdist              |
| `js-napi/`                | npm  | napi         | 5 platform pkgs + 1 main        |
| `js-bundled-cli/`         | npm  | bundled-cli  | 5 platform pkgs + 1 main (shim) |

## Polyglot (#31)

Cross-language `depends_on` cascades. Changing a `.rs` file triggers the dependent package(s).

| Path                             | Packages                                     |
|----------------------------------|----------------------------------------------|
| `polyglot-rust-python/`          | crates + pypi (maturin, depends_on)          |
| `polyglot-rust-js-napi/`         | crates + npm (napi, depends_on)              |
| `polyglot-rust-js-bundled/`      | crates + npm (bundled-cli, depends_on)       |
| `polyglot-everything/`           | crates + pypi + npm (bundled-cli) — dirsql shape |

`polyglot-everything/` is the v0 success criterion (plan.md §25.3 #2) — publishes cleanly on a real cadence against the canary family.

## E2E canary (#28)

`e2e-canary/` — minimal npm vanilla fixture used by the E2E harness. Isolated from #29 because it's the one that actually publishes on every E2E run.

## Version placeholder

Fixtures use `__VERSION__` as a substitute for their version fields. The E2E harness rewrites it at test time via `makeE2ERepo()`; golden-file tests leave it literal.
