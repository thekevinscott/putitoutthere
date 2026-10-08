# Crates token fallback

**Summary.** The reusable workflow now accepts an optional
`CARGO_REGISTRY_TOKEN` via `secrets:`. Trusted Publishing on
crates.io binds to an *already-published* crate, so the very
first publish of a brand-new crate has no OIDC path available;
without this fallback consumers had to either fork the workflow
or publish once outside it. OIDC trusted publishers remain the
default and recommended path — when the secret is unset,
behavior is byte-for-byte unchanged. When the secret is set,
the `rust-lang/crates-io-auth-action` OIDC exchange is skipped
and the caller-provided token is exported to `$GITHUB_ENV` as
`CARGO_REGISTRY_TOKEN` for the engine's crates handler to read.
The header comment in `.github/workflows/release.yml` has been
softened to match: previously *"Long-lived registry tokens are
explicitly NOT supported via this workflow"*; now OIDC is
described as the default with the token fallback called out for
first-publish bootstrap. #283.

**Required changes.** None for consumers already on the OIDC
path. To bootstrap a brand-new crate or to use the workflow on
an account where Trusted Publishing isn't available, wire the
secret in the caller's `release.yml`:

| Before                                                                                 | After                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0`                   | `uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0`<br>`secrets:`<br>`  CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}`                                   |

The repo-level secret holding the crates.io API token can be
named anything; the *workflow* secret it gets passed as must
be `CARGO_REGISTRY_TOKEN` exactly — the reusable workflow keys
on that name. Drop the `secrets:` block from the caller's
`release.yml` once Trusted Publishing is registered against
the now-existing crate; subsequent publishes are zero-secret.

**Deprecations removed.** None.

**Behavior changes without code changes.** None when the secret
is unset (OIDC path unchanged). When the secret is set, the
publish job's "Authenticate with crates.io (OIDC)" step is
conditionally skipped and a new "Export CARGO_REGISTRY_TOKEN
(caller-provided)" step writes the secret to `$GITHUB_ENV`
gated on the same condition. The gate reads the secret through a
job-level `CALLER_CARGO_REGISTRY_TOKEN` env var because GitHub
Actions does not allow the `secrets` context inside step-level
`if:` conditions ([context availability](https://docs.github.com/en/actions/learn-github-actions/contexts#context-availability));
this is an internal mechanism — consumers don't see or set
`CALLER_CARGO_REGISTRY_TOKEN` themselves.

**Verification.** Wire `CARGO_REGISTRY_TOKEN` to a valid
crates.io API token in the caller repo and trigger a release.
The publish-job logs should show "Authenticate with crates.io
(OIDC)" as `skipped`, "Export CARGO_REGISTRY_TOKEN (OIDC)" as
`skipped`, and "Export CARGO_REGISTRY_TOKEN (caller-provided)"
as `success`. The crate publishes; the only difference visible
in the registry is the publish was authorised against the
caller-provided token rather than an OIDC-minted ephemeral one.

---
