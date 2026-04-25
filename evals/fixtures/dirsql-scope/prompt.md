You are evaluating whether `putitoutthere` (piot) is suitable for replacing
the release machinery in `thekevinscott/dirsql` — a Cargo workspace that
ships three artifacts from one Rust core:

- crates.io `dirsql` — plain cargo, `cli` is an opt-in feature
- PyPI `dirsql` — maturin + PyO3, targeted wheels
- npm `dirsql` — napi-rs with a per-platform binary family

## dirsql's current release shape

- 5 workflows: `patch-release.yml` (orchestrator), `publish.yml` (PyPI +
  crates via OIDC), `publish-npm.yml` (legacy 11-package npm family via
  `NPM_TOKEN`), `release.yml` (cargo-dist for GH Release archives),
  `release-scripts.yml` (CI for Python helpers).
- OIDC trusted publishers registered on all three registries; trust
  policies pin the caller workflow filename.
- npm distribution historically shipped as a family:
  `@dirsql/cli-<slug>` × 5 (CLI binaries) + `@dirsql/lib-<slug>` × 5
  (napi `.node` files) + top-level `dirsql` pinning them via
  `optionalDependencies`.
- Cross-compile reliability is a real concern: v0.2.0 shipped without
  `aarch64-unknown-linux-gnu` because default `ubuntu-latest` failed to
  cross-link; fix was `ubuntu-24.04-arm` native runner.
- Partial-failure operational lesson: if crates.io succeeded but another
  registry failed, the git tag must NOT be deleted (crates.io is
  permanent).

## Your task

Investigate piot's current capabilities. The docs are at
<https://thekevinscott.github.io/putitoutthere/>. Based on what you
can discover, write an opinionated evaluation:

1. What does piot already support well for this migration?
2. What gaps, if any, block adoption or need changes to piot itself?
3. What primitives would you recommend adding to piot (if any) to
   unblock dirsql?

Be specific and cite evidence where possible. Don't hedge unnecessarily —
the user wants a real evaluation, not a survey. Reach concrete
conclusions about what is and isn't already implemented in piot.
