# Authentication

::: warning Page being rewritten
The reusable-workflow surface is in flux. This page describes the engine's auth model, which is stable; integration glue (how `[package.trust_policy]` validation is surfaced) will change as the new workflow lands. See [design commitments](https://github.com/thekevinscott/putitoutthere/blob/main/notes/design-commitments.md).
:::

`putitoutthere` authenticates to crates.io, PyPI, and npm via **OIDC trusted publishing** by default. No long-lived registry tokens, no secrets in env vars. This is the recommended path for any library published from GitHub Actions.

## One-time setup: register a trusted publisher per registry

You have to tell each registry that your GitHub workflow is allowed to publish on your behalf. Do this once per package; after that, every push-to-main publish is zero-configuration.

For each registry, the fields are the same: repository owner/name, workflow filename, and optionally a GitHub environment name.

### crates.io

1. Publish your crate once through the normal cargo flow so the crate exists. (Trusted publishing needs a crate owner record.)
2. Go to `https://crates.io/crates/<crate>/settings` → **Trusted Publishing** → **Add**.
3. Fill in: repository owner, repository name, workflow filename (e.g. `release.yml`), environment (optional).

The workflow then uses [`rust-lang/crates-io-auth-action@v1`](https://github.com/rust-lang/crates-io-auth-action) to exchange the OIDC JWT for a short-lived `CARGO_REGISTRY_TOKEN`. No long-lived token in repo secrets.

### PyPI

1. Go to `https://pypi.org/manage/project/<name>/settings/publishing/` (or **Publishing** on the project page).
2. Add a **GitHub** trusted publisher: owner, repo, workflow filename, environment (optional).
3. For a brand-new project, use a [pending publisher](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/) to skip the bootstrap token.

`putitoutthere` calls PyPI's `/_/oidc/mint-token` endpoint itself; no external action needed.

### npm

1. Publish at least one version of your package with a classic `NODE_AUTH_TOKEN` so the package exists on the registry. (npm's trusted publisher requires an existing package.)
2. Go to `https://www.npmjs.com/package/<name>/access` → **Require trusted publisher**.
3. Fill in: repository, workflow filename, environment (optional).
4. Delete the bootstrap token.

`actions/setup-node` with `id-token: write` permission is all the workflow needs; npm-cli handles the OIDC exchange on `npm publish --provenance`.

## Workflow permissions

Your publishing workflow needs:

```yaml
permissions:
  contents: read
  id-token: write
```

`id-token: write` is the permission that lets GitHub mint the OIDC JWT that every registry's trusted-publisher check consumes. Without it, all three exchanges fail.

## Declaring trust-policy expectations

Renaming a workflow from `release.yml` to `patch-release.yml`, or renaming an environment from `release` to `production`, breaks publish with an opaque HTTP 400 from the registry's token endpoint. There is no local reproduction — `cargo publish` works, `twine upload` works, but the OIDC exchange fails because the registry's trust policy still points at the old name.

To catch this before release, declare the expected values in `putitoutthere.toml`:

```toml
[[package]]
name = "my-crate"
kind = "crates"
path = "crates/my-crate"
paths = ["crates/my-crate/**"]

[package.trust_policy]
workflow    = "release.yml"              # required; bare filename, not a path
environment = "release"                  # optional
repository  = "my-org/my-crate"          # optional; owner/repo
```

The engine validates the declared values against the local workflow file and the runtime `GITHUB_WORKFLOW_REF` before any registry call. For `kind = "crates"` packages, a registry cross-check runs when `CRATES_IO_DOCTOR_TOKEN` is set — calls crates.io's trusted-publishing read API and diffs each registered config against the declaration. On mismatch, publish fails with the specific field that disagrees.

PyPI has no current-policy read endpoint (its Integrity API returns provenance for past publishes, not current trust-publisher configs). npm's `GET /-/package/{name}/trust` exists but requires 2FA/OTP on every call and rejects granular-access tokens — unusable from CI. For those two, the declared block captures your intent and the local-workflow diff catches the common rename failure; there is no live registry cross-check.

## Fallback: long-lived tokens

When trusted publishing isn't an option — first-ever publish, air-gapped CI, self-hosted runners without OIDC, private registries — you can still use env-var tokens. `putitoutthere` accepts:

| Kind     | Env var                                  |
|----------|------------------------------------------|
| `crates` | `CARGO_REGISTRY_TOKEN`                   |
| `pypi`   | `PYPI_API_TOKEN`                         |
| `npm`    | `NODE_AUTH_TOKEN` (or `NPM_TOKEN`)       |

Per-handler auth precedence, if both are present: OIDC wins for PyPI and npm (OIDC-minted token supersedes `PYPI_API_TOKEN` / bypasses `NODE_AUTH_TOKEN`). crates.io takes whichever value ends up in `CARGO_REGISTRY_TOKEN` — the workflow decides.

Empty-string env vars are treated as unset (see `src/env.ts`), so an un-configured `PYPI_API_TOKEN` secret won't shadow the OIDC path.
