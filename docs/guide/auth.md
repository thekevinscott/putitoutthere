# Authentication

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

## Fallback: long-lived tokens

When trusted publishing isn't an option — first-ever publish, air-gapped CI, self-hosted runners without OIDC, private registries — you can still use env-var tokens. `putitoutthere` accepts:

| Kind     | Env var                                  |
|----------|------------------------------------------|
| `crates` | `CARGO_REGISTRY_TOKEN`                   |
| `pypi`   | `PYPI_API_TOKEN`                         |
| `npm`    | `NODE_AUTH_TOKEN` (or `NPM_TOKEN`)       |

Per-handler auth precedence, if both are present: OIDC wins for PyPI and npm (OIDC-minted token supersedes `PYPI_API_TOKEN` / bypasses `NODE_AUTH_TOKEN`). crates.io takes whichever value ends up in `CARGO_REGISTRY_TOKEN` — the workflow decides.

Empty-string env vars are treated as unset (see `src/env.ts`), so an un-configured `PYPI_API_TOKEN` secret won't shadow the OIDC path. `doctor` and `preflight` surface missing auth before publish.

## Optional: inspect configured secrets from the CLI

`putitoutthere auth login` signs you in through a public GitHub App and unlocks `token list --secrets`, which shows the *names* (never values) of registry-shaped secrets configured on the current repo + its environments so you can cross-check them against your `putitoutthere.toml`. Skip this unless you actually want that cross-check — nothing else in the CLI depends on it.

```
$ putitoutthere token list --secrets
REGISTRY  SOURCE               ENV/NAME              DETAILS
npm       repo-secret          NPM_TOKEN             repo secret (owner/repo)
pypi      environment-secret   PYPI_API_TOKEN        environment secret (production)
```

Without `--secrets`, `token list` only scans `process.env` on the local machine. With `--secrets`, it also calls `GET /repos/{owner}/{repo}/actions/secrets` and the per-environment endpoint, filters to names that look like registry credentials (exact matches plus `PYPI_*` / `NPM_*` / `CARGO_*` / `TWINE_*` prefixes), and appends them to the table. If you haven't run `auth login`, `--secrets` prints a one-line note and still emits whatever env-var matches it found.

The App is `putitoutthere-cli` (client ID `Iv23lio0NtN1koa0Rwle`). Login uses [OAuth Device Flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) and requests read-only access to secrets, environments, and actions metadata. Install it on demand from [github.com/apps/putitoutthere-cli](https://github.com/apps/putitoutthere-cli/installations/new); revoke anytime from [github.com/settings/apps/authorizations](https://github.com/settings/apps/authorizations).
