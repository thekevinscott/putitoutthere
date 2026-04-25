You are evaluating whether `putitoutthere` (piot) is suitable for replacing
the release machinery in `thekevinscott/dirsql`.

## dirsql at a glance

A Cargo workspace with one Rust core crate, publishing three artifacts
from the same source:

- crates.io — `dirsql`, a plain `cargo publish`
- PyPI — `dirsql`, built with maturin + PyO3 (targeted wheels)
- npm — `dirsql`, built with napi-rs as a per-platform binary family

The Rust core is shared; a release bumps all three in lockstep. Tags are
per-artifact-family (`dirsql-v{version}`). The existing release
machinery is 5 workflows in `.github/workflows/`:

- `patch-release.yml` — orchestrator (manual or trailer-triggered)
- `publish.yml` — PyPI + crates (via OIDC)
- `publish-npm.yml` — npm family publish
- `release.yml` — GitHub Release archives
- `release-scripts.yml` — CI for Python helper scripts

All three registries use OIDC trusted publishing; no long-lived tokens.

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
