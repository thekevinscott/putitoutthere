# `[package.bundle_cli]` now actually stages the binary

**Summary.** Wheels published from a maturin pypi package that
declared `[package.bundle_cli]` previously shipped without the
bundled CLI binary. The block was parsed by config, attached to
per-target wheel rows by the planner, and documented in the README
and MIGRATIONS — but the reusable workflow's build job
(`.github/workflows/_matrix.yml`) had no step that consumed the
metadata. Consumers' wheels arrived on PyPI missing the file the
launcher in `[project.scripts]` resolved at runtime, and
`pip install <pkg> && <pkg> ...` failed with `FileNotFoundError`.
The recipe was advertised as shipped in v0.2.0 (#217) but was
silently a no-op for over a release cycle. Hit in the wild on
`thekevinscott/dirsql`; tracked in #282.

The workflow now runs four new steps for every per-target wheel
row where `matrix.bundle_cli` is set:

1. `rustup target add ${{ matrix.target }}` — make the triple known.
2. `cargo build --release --target ${{ matrix.target }} --bin ${{ matrix.bundle_cli.bin }}`
   against `crate_path` — produce the binary on the native host
   runner (`defaultRunsOn` in `src/plan.ts` already maps every
   supported triple to a native runner, so cross-compile linkers
   are not needed).
3. Copy the resulting binary (with `.exe` suffix on Windows) into
   `${{ matrix.path }}/${{ matrix.bundle_cli.stage_to }}/` so
   maturin's `[tool.maturin].include` glob picks it up as wheel
   data.
4. After `PyO3/maturin-action@v1` produces the `.whl`, open the
   wheel and refuse `upload-artifact` if it does not contain a
   file at any directory ending in `<stage_to>/<bin>`. This guard
   stays useful after the staging steps land — it catches any
   future regression where the cross-compile silently routes the
   binary to the wrong path, and it ensures broken wheels never
   leave the build runner.

**Required changes.** None for consumers whose existing
`[package.bundle_cli]` block follows the documented shape — the
recipe simply starts working. Consumers who relied on the broken
state (e.g., shipped a workaround that hardcoded a copy of the
binary into the source tree before `putitoutthere` ran) can
remove the workaround.

**Constraint not previously documented.** The cross-compile
assumes the binary is buildable with a vanilla
`cargo build --release --bin <bin>` — no env vars, no special
build config. Crates that gate the CLI behind a Cargo feature
(e.g., `--features cli`) are now supported via
`[package.bundle_cli].features` and
`[package.bundle_cli].no_default_features`; see
[`bundle_cli` features and `no_default_features`](2026-05-10-package-bundle-cli-features-and-no-default.md).

**Deprecations removed.** None.

**Behavior changes without code changes.** Existing
`[package.bundle_cli]` blocks change behavior at upgrade time:
the next release run produces wheels that contain the binary
(previously the workflow silently published wheels without it).
If a consumer's `[tool.maturin].include` path resolves to nothing
(typo, mismatched layout), the new wheel-content guard fails the
build red instead of silently uploading an unusable wheel.

**Verification.** After upgrading, trigger a release on a maturin
package that declares `[package.bundle_cli]`. The build job's log
includes a `bundle_cli — verify wheel contains <stage_to>/<bin>`
step that ends with `ok bundle_cli: <stage_to>/<bin> present in
<wheel-name>.whl`. The published wheel, when downloaded and
unzipped, contains the binary at the expected path.
`pip install <pkg> && <pkg> --version` runs the launcher and the
launcher resolves the binary inside the wheel.

---
