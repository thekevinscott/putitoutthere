# Authentication

`putitoutthere` authenticates to GitHub through a public GitHub App — **`putitoutthere-cli`** — using the OAuth 2.0 Device Authorization Flow. No personal access token, no client secret, no long-lived credential in your shell profile.

## The App

| Field | Value |
|-------|-------|
| Name | `putitoutthere-cli` |
| Owner | [`@thekevinscott`](https://github.com/thekevinscott) |
| Client ID | `Iv23lio0NtN1koa0Rwle` |
| Install URL | [`https://github.com/apps/putitoutthere-cli/installations/new`](https://github.com/apps/putitoutthere-cli/installations/new) |
| Device Flow | enabled |
| Webhook | disabled |

The client ID is public. GitHub treats it the same way it treats an OAuth app's client ID — safe to commit, safe to ship inside the published npm package.

## Permissions requested

All permissions are **read-only**. The App cannot modify repositories, trigger workflows, or read code.

| Scope | Level | Why |
|-------|-------|-----|
| `Secrets: Read` | Repository | List secret names so `token list` can tell you which registry tokens are configured in CI. |
| `Environments: Read` | Repository | Surface per-environment secret names (e.g. `production` vs `staging`). |
| `Actions: Read` | Repository | Correlate secrets with the workflows that consume them. |
| `Secrets: Read` | Organization | Discover org-level secrets available to the repo. |

Secret *values* are never returned — GitHub only exposes names and timestamps through these endpoints.

## How the Device Flow works

1. You start auth on your machine. The CLI calls `POST https://github.com/login/device/code` with the client ID above and receives a short user code plus a verification URL.
2. The CLI prints the code and asks you to visit `https://github.com/login/device` in a browser.
3. You enter the code, sign in to GitHub, and approve the requested permissions. On first use, GitHub also prompts you to install the App on the repos or org you want it to see.
4. The CLI polls `POST https://github.com/login/oauth/access_token` until GitHub returns a user access token (and a refresh token).
5. The CLI stores both tokens in your OS keychain — macOS Keychain, libsecret on Linux, DPAPI on Windows.

The resulting token carries the intersection of what the App requested and what you granted. It expires after 8 hours; the refresh token is valid for 6 months and is rotated silently on the next 401.

## Installing the App

On first auth, GitHub walks you through the install. To install or manage access later, visit the install URL directly:

```
https://github.com/apps/putitoutthere-cli/installations/new
```

Pick **Only select repositories** if you want to limit which repos the CLI can see. You can change the selection or uninstall at any time from [`https://github.com/settings/installations`](https://github.com/settings/installations).

## Revoking access

- **Per-installation:** [`https://github.com/settings/installations`](https://github.com/settings/installations) → *Configure* → *Uninstall*.
- **Per-token:** [`https://github.com/settings/apps/authorizations`](https://github.com/settings/apps/authorizations) → *Revoke*.

Revocation takes effect immediately. The next CLI command that needs the token prompts you to re-auth.

## CI

The App-based flow is designed for human logins, not workflow runs. Inside GitHub Actions, keep using the default `GITHUB_TOKEN` and whatever registry tokens you already store as repo secrets. The CLI skips keychain lookup when it detects `CI=true`.
