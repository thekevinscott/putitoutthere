/**
 * Stable error-code vocabulary.
 *
 * User-facing errors and GitHub Actions `::error::` annotations carry
 * one of these codes so external observers — humans grepping the run
 * log, foreign LLM agents debugging a failed publish, the docs site
 * deep-linking from a code to a recipe — can fingerprint the failure
 * mode without parsing free-form prose.
 *
 * Codes are deliberately verbose. The string is the diagnostic; brevity
 * here just creates ambiguity at a distance.
 *
 * Adding a new code: add it to BOTH `ErrorCodes` and `ALL_ERROR_CODES`;
 * the test in `error-codes.test.ts` enforces parity. Once a code ships
 * in a public-surfaced error message it becomes a stable identifier —
 * rename only with a migration entry.
 */

export const ErrorCodes = {
  /** Generic auth failure when no registry token resolved. Used by
   *  npm/crates handlers; PyPI no longer surfaces this code (the
   *  upload moved to a caller-side job per the reusable-workflow
   *  TP constraint — see notes/audits/). */
  AUTH_NO_TOKEN: 'PIOT_AUTH_NO_TOKEN',
  /** `publish` was invoked but `plan` returned zero rows for a reason
   *  other than `release: skip`. Almost always indicates the cascade
   *  did not trigger (no committed file matched any package's globs
   *  since its last tag) or that the plan and publish jobs disagreed
   *  on what HEAD looked like. The reusable workflow's gate should
   *  prevent this from being reached; if it fires, the gate was
   *  bypassed or the engine is inconsistent. */
  PUBLISH_EMPTY_PLAN: 'PIOT_PUBLISH_EMPTY_PLAN',
  /** An npm package's `package.json` is missing a non-empty
   *  `repository` field. `npm publish --provenance` (the OIDC
   *  trusted-publisher path) requires it so the registry can verify
   *  the artifact was built from the repo the trusted publisher
   *  declares. Failing at preflight prevents wasting a build run on
   *  a precondition checkable in milliseconds. #280. */
  NPM_MISSING_REPOSITORY: 'PIOT_NPM_MISSING_REPOSITORY',
  /** A crates package's `Cargo.toml` is missing one or more
   *  required `[package]` metadata fields (`description` and
   *  `license`/`license-file`). crates.io rejects the publish with
   *  `400 Bad Request: missing or empty metadata fields: ...` after
   *  cargo's verification build has compiled the crate and every
   *  transitive dep. Failing at preflight catches the precondition
   *  in milliseconds. #290. */
  CRATES_MISSING_METADATA: 'PIOT_CRATES_MISSING_METADATA',
  /** A pypi package's `pyproject.toml` declares a static
   *  `[project].version = "..."` literal instead of
   *  `[project].dynamic = ["version"]`. putitoutthere does not edit
   *  the literal at release time (per design-commitment #1, no
   *  version computation), so the build backend reads whatever is on
   *  disk and silently ships the previous release's wheel/sdist.
   *  The fix is `dynamic = ["version"]` with hatch-vcs as the source
   *  (the recommended path; setuptools-scm and the maturin
   *  Cargo.toml-driven path are equally valid). */
  PYPI_STATIC_VERSION: 'PIOT_PYPI_STATIC_VERSION',
  /** A pypi package's `pyproject.toml` declares a `[project].name` that
   *  differs from the `[[package]].name` configured in
   *  `putitoutthere.toml` (or the `pypi` override when set). The build
   *  tool will pack the wrong name and the upload either lands on the
   *  wrong registered project or 403s with a confusing "no such project"
   *  message. #301. */
  PYPI_NAME_MISMATCH: 'PIOT_PYPI_NAME_MISMATCH',
  /** A pypi package's `[build-system].build-backend` is set but does
   *  not match the configured `build` mode (e.g. `build = "maturin"`
   *  but the pyproject declares `hatchling.build`). The build tool
   *  surfaces a confusing tail-end error long after maturin has run.
   *  #301. */
  PYPI_BUILD_BACKEND_MISMATCH: 'PIOT_PYPI_BUILD_BACKEND_MISMATCH',
  /** A pypi package declares `dynamic = ["version"]` but no
   *  version-source backend block (`[tool.hatch.version]` /
   *  `[tool.setuptools_scm]`) is present, so the build backend has no
   *  way to compute a version at pack time. #301. */
  PYPI_DYNAMIC_VERSION_NO_BACKEND: 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND',
  /** A maturin pypi package declares `[package.bundle_cli]` but
   *  `[tool.maturin].include` does not cover the configured
   *  `bundle_cli.stage_to` path, so the cross-compiled binary will
   *  never make it inside the wheel. The post-build wheel-content
   *  guard catches it, but only after maturin has run. #301. */
  PYPI_MATURIN_INCLUDE_MISSING: 'PIOT_PYPI_MATURIN_INCLUDE_MISSING',
  /** A crates package's `Cargo.toml` declares a `[package].name` that
   *  differs from the `[[package]].name` configured in
   *  `putitoutthere.toml` (or the `crate` override when set). cargo
   *  publish will pack the wrong crate, often 404'ing on the registry
   *  side after a verification build that took 10+ minutes. #301. */
  CRATES_NAME_MISMATCH: 'PIOT_CRATES_NAME_MISMATCH',
  /** A `bundle_cli.bin` is configured but the target `Cargo.toml` has
   *  no `[[bin]]` table with that name (and the implicit-bin name
   *  derived from `[package].name` does not match either). `cargo
   *  build --bin <bin>` fails with `no bin target named ...` mid-
   *  build. #301. */
  CRATES_MISSING_BIN: 'PIOT_CRATES_MISSING_BIN',
  /** A `features` list (either on a `kind = "crates"` package or on
   *  a `bundle_cli` block) references a feature that the target
   *  `Cargo.toml` does not declare in `[features]`. `cargo build
   *  --features <list>` fails with `Package ... does not have these
   *  features`. #301. */
  CRATES_FEATURE_NOT_DECLARED: 'PIOT_CRATES_FEATURE_NOT_DECLARED',
  /** A crates package's `Cargo.toml` declares `version.workspace =
   *  true`, but no ancestor `Cargo.toml` with a `[workspace]` table
   *  declares `[workspace.package].version`. cargo fails with
   *  `error: failed to inherit "version" from workspace`. #301. */
  CRATES_WORKSPACE_VERSION_MISMATCH: 'PIOT_CRATES_WORKSPACE_VERSION_MISMATCH',
  /** crates.io rejected `cargo publish` because the crate has never been
   *  published. Trusted Publishing on crates.io binds to an
   *  already-published crate — the OIDC mint succeeds, the exchanged
   *  token reaches cargo, but the registry returns 404 ("crate `<name>`
   *  does not exist or you do not have permission to publish to it").
   *  The fix is one bootstrap publish with a classic `CARGO_REGISTRY_TOKEN`;
   *  trusted publishing works for every release after. #284. */
  CRATES_FIRST_PUBLISH_TP_REJECTED: 'PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED',
  /** A crates package's `.crate`, as produced by `cargo package`, is
   *  larger than crates.io's 10 MiB (`10485760`-byte) upload limit.
   *  `cargo publish` would fail with `413 Payload Too Large` only
   *  mid-release, after the verification build; `runChecks` reproduces
   *  the tarball at PR time so the regression is caught before merge.
   *  A tracked symlink pointing into a build directory, or a missing
   *  `[package].exclude`, is the usual cause of build output landing
   *  in the crate. #362. */
  CRATES_PACKAGE_TOO_LARGE: 'PIOT_CRATES_PACKAGE_TOO_LARGE',
  /** A manifest's declared repository URL resolves to a different
   *  `owner/repo` than the GitHub repository the workflow is running
   *  from (`GITHUB_REPOSITORY`). npm's provenance verification compares
   *  `package.json#repository.url` against the OIDC source claim and
   *  returns a 422 after artifact upload — Cargo.toml `[package].repository`
   *  and pyproject.toml `[project.urls]` carry the same risk on
   *  crates.io / PyPI trusted-publisher paths. Failing at preflight
   *  catches the mismatch in milliseconds. */
  REPO_URL_MISMATCH: 'PIOT_REPO_URL_MISMATCH',
  /** The GitHub repository the workflow is running from is private.
   *  putitoutthere refuses to publish from a private repository:
   *  npm provenance attestations embed a source-ref pointer that
   *  consumers cannot dereference when the repo is private, and the
   *  same source-visibility expectation underpins the trusted-publisher
   *  story on the other registries. */
  REPO_PRIVATE: 'PIOT_REPO_PRIVATE',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Iterable form of the codes. Walked by tests for uniqueness/format
 * checks and by future tooling that renders a code reference table.
 */
export const ALL_ERROR_CODES: readonly ErrorCode[] = [
  ErrorCodes.AUTH_NO_TOKEN,
  ErrorCodes.PUBLISH_EMPTY_PLAN,
  ErrorCodes.NPM_MISSING_REPOSITORY,
  ErrorCodes.CRATES_MISSING_METADATA,
  ErrorCodes.PYPI_STATIC_VERSION,
  ErrorCodes.PYPI_NAME_MISMATCH,
  ErrorCodes.PYPI_BUILD_BACKEND_MISMATCH,
  ErrorCodes.PYPI_DYNAMIC_VERSION_NO_BACKEND,
  ErrorCodes.PYPI_MATURIN_INCLUDE_MISSING,
  ErrorCodes.CRATES_NAME_MISMATCH,
  ErrorCodes.CRATES_MISSING_BIN,
  ErrorCodes.CRATES_FEATURE_NOT_DECLARED,
  ErrorCodes.CRATES_WORKSPACE_VERSION_MISMATCH,
  ErrorCodes.CRATES_FIRST_PUBLISH_TP_REJECTED,
  ErrorCodes.CRATES_PACKAGE_TOO_LARGE,
  ErrorCodes.REPO_URL_MISMATCH,
  ErrorCodes.REPO_PRIVATE,
];
