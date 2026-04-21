# Authentication

`putitoutthere` reads registry tokens from environment variables. That's it for the common case — both locally and in CI.

| Kind     | Env var                 |
|----------|-------------------------|
| `crates` | `CARGO_REGISTRY_TOKEN`  |
| `pypi`   | `PYPI_API_TOKEN`        |
| `npm`    | `NODE_AUTH_TOKEN`       |

In CI, store each token as a repo secret and map it into the job's env. `doctor` and `preflight` check presence before you publish.

## Optional: inspect configured secrets from the CLI

`putitoutthere auth login` signs you in through a public GitHub App and unlocks `token list`, which shows the *names* (never values) of secrets configured on a repo so you can cross-check them against your `putitoutthere.toml`. Skip this unless you actually want that cross-check — nothing else in the CLI depends on it.

The App is `putitoutthere-cli` (client ID `Iv23lio0NtN1koa0Rwle`). Login uses [OAuth Device Flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) and requests read-only access to secrets, environments, and actions metadata. Install it on demand from [github.com/apps/putitoutthere-cli](https://github.com/apps/putitoutthere-cli/installations/new); revoke anytime from [github.com/settings/apps/authorizations](https://github.com/settings/apps/authorizations).
