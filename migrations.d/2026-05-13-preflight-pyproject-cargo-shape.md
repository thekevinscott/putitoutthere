# Preflight pyproject + cargo shape

**Summary.** Preflight gains two more checks — `requirePyprojectShape`
and `requireCargoShape` — that mirror the #280 / #290 pattern for
`pyproject.toml` (pypi packages) and `Cargo.toml` (crates packages,
plus `bundle_cli` on pypi packages). The maturin / setuptools /
hatchling / cargo CLIs surface mismatched-shape errors 10-20 minutes
into a release run, deep into the verification build, with messages
that don't name the precondition that failed. The new checks fire at
publish time alongside the existing `require*` family and at PR time
via `check.yml`. Findings aggregate across every failing package so
consumers fix them all in one round-trip, exactly the shape the prior
checks established. #301.

**Required changes.** None for well-formed manifests. Repos that
declared one of the documented mismatches below previously got a
mid-release red; they now get a fast preflight red instead.

The new error codes:

| Code | Fires when |
|------|------------|
| `PIOT_PYPI_NAME_MISMATCH` | `pyproject.toml`'s `[project].name` differs from `[[package]].name` (or the `pypi` override). |
| `PIOT_PYPI_BUILD_BACKEND_MISMATCH` | `[build-system].build-backend` is set and does not start with the prefix the configured `build` mode expects (`maturin` → `maturin`, `setuptools` → `setuptools`, `hatch` → `hatchling`/`hatch`). |
| `PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND` | `[project].dynamic` includes `"version"` but neither `[tool.hatch.version]` nor `[tool.setuptools_scm]` is present. |
| `PIOT_PYPI_MATURIN_INCLUDE_MISSING` | `bundle_cli` is set but `[tool.maturin].include` does not cover `bundle_cli.stage_to`. |
| `PIOT_CRATES_NAME_MISMATCH` | `Cargo.toml`'s `[package].name` differs from `[[package]].name` (or the `crate` override). |
| `PIOT_CRATES_MISSING_BIN` | `bundle_cli.bin` is set but the target `Cargo.toml` has no `[[bin]]` table with that name (and the implicit-bin name derived from `[package].name` does not match either). |
| `PIOT_CRATES_FEATURE_NOT_DECLARED` | `features` (on `kind = "crates"` packages) or `bundle_cli.features` references a feature not declared in `[features]`. |
| `PIOT_CRATES_WORKSPACE_VERSION_MISMATCH` | `[package].version.workspace = true` but no ancestor `Cargo.toml` declares `[workspace.package].version`. |

**Deprecations removed.** None.

**Behavior changes without code changes.** Repos with one of the
shapes above used to get a confusing mid-release error from
maturin / setuptools / hatchling / cargo (sometimes after a
verification build of every transitive dep); they now get a
fingerprintable `PIOT_*` error at preflight time, before any side
effects. PR-time `check.yml` runs surface the same findings on
every pull request, so the typical case is fix-before-merge rather
than fix-after-release-red. The `[build-system].build-backend`
check is deliberately narrow: a missing `[build-system]` table is
allowed (pip falls back to setuptools), and the prefix match
tolerates backend-version drift across maturin / setuptools /
hatchling.

**Verification.** Misconfigure one field, run `pnpm putitoutthere
check` (or open a PR with `check.yml` wired), see the relevant
`PIOT_*` code surface in seconds instead of mid-release.
