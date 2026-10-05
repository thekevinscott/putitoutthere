# npm token fallback

**Summary.** The reusable workflow now accepts an optional
`NPM_TOKEN` via `secrets:`. Trusted Publishing on npm binds to
an *already-published* package, so the very first publish of a
brand-new npm package has no OIDC path available; without this
fallback every first-time bundled-cli / napi consumer hit a 6+
package manual `0.0.0-bootstrap` stub bootstrap, documented
nowhere, only discoverable by reading commit history of dirsql
or by hitting the failure. OIDC trusted publishers remain the
default and recommended path — when the secret is unset,
behavior is byte-for-byte unchanged. When the secret is set
AND the planned matrix contains an npm row, the secret is
exported to `$GITHUB_ENV` as `NODE_AUTH_TOKEN`; the npm CLI
then prefers the long-lived token over the OIDC path. Mirror
of #283 (crates) in shape, byte-for-byte. Hit in the wild on
the maintainer's own dirsql project (first version of
`@dirsql/cli-linux-x64-gnu` on npm is `0.0.0-bootstrap`,
2026-04-30; real `0.2.8` lands the next day) and on
`darkfactory`'s first publish. #302.

**Required changes.** None for consumers already on the OIDC
path. To bootstrap a brand-new npm package or to use the
workflow on an account where Trusted Publishing isn't
available, wire the secret in the caller's `release.yml`:

| Before                                                                                 | After                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0`                   | `uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0`<br>`secrets:`<br>`  NPM_TOKEN: ${{ secrets.NPM_TOKEN }}`                                         |

The repo-level secret holding the npm automation token can be
named anything; the *workflow* secret it gets passed as must be
`NPM_TOKEN` exactly — the reusable workflow keys on that name.
Drop the `secrets:` block from the caller's `release.yml` once
Trusted Publishing is registered against the (now-existing)
package; subsequent publishes are zero-secret. For bundled-cli
/ napi families each per-platform sub-package needs its own
Trusted Publisher registration after the first publish — the
secret-bypass is a one-time bootstrap, not a permanent path.

**Deprecations removed.** None.

**Behavior changes without code changes.** None when the secret
is unset (OIDC path unchanged). When the secret is set, a new
"Export NODE_AUTH_TOKEN (caller-provided)" step writes
`NODE_AUTH_TOKEN` to `$GITHUB_ENV` gated on the secret being
non-empty AND the planned matrix containing an npm row. The
gate reads the secret through a job-level `CALLER_NPM_TOKEN`
env var because GitHub Actions does not allow the `secrets`
context inside step-level `if:` conditions ([context
availability](https://docs.github.com/en/actions/learn-github-actions/contexts#context-availability));
this is an internal mechanism — consumers don't see or set
`CALLER_NPM_TOKEN` themselves. Unlike #283 (crates), there is
no separate OIDC step to "skip" — the npm CLI handles OIDC
internally via the runner's id-token, and the presence of
`NODE_AUTH_TOKEN` in the env is what switches the CLI's auth
mode.

**Verification.** Wire `NPM_TOKEN` to a valid npm automation
token in the caller repo and trigger a release of a brand-new
package. The publish-job logs should show "Export
NODE_AUTH_TOKEN (caller-provided)" as `success`; `npm publish`
authenticates with the long-lived token rather than via OIDC,
and every per-platform sub-package in a bundled-cli / napi
family lands on the registry in a single run. Once first
publish succeeds, register Trusted Publishers against each
package URL, drop the `secrets:` block, and re-run a release
— the OIDC path covers the steady state from there.

Verified end-to-end against existing seeded fixtures and a
real first-publish on a canary repo. The Verdaccio
first-publish fixture coverage for the same path is tracked
separately at #293; until that lands this fallback is verified
by composition (mirror of #283) plus consumer-side observation
on real first publishes rather than by an automated
fresh-state fixture in this repo's CI.

---
