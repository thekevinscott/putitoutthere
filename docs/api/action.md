# GitHub Action

`thekevinscott/put-it-out-there@v0` wraps the CLI for use in GitHub Actions workflows.

## Inputs

| Input            | Default | Description                                                     |
|------------------|---------|-----------------------------------------------------------------|
| `command`        | `plan`  | `plan` \| `publish` \| `doctor`.                                |
| `dry_run`        | `false` | (publish) Skip side effects.                                    |
| `fail_on_error`  | `true`  | Exit non-zero on failure (otherwise log + continue at 0).       |

## Outputs

| Output   | Description                                           |
|----------|-------------------------------------------------------|
| `matrix` | (plan only) JSON array the `build` job can fan out across. |

## Permissions required

```yaml
permissions:
  contents: write    # publish: tag + release creation
  id-token: write    # OIDC trusted-publisher exchange
```

## Minimal workflow

```yaml
on: { push: { branches: [main] } }

jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.plan.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - id: plan
        uses: thekevinscott/put-it-out-there@v0
        with: { command: plan }

  publish:
    needs: plan
    if: fromJSON(needs.plan.outputs.matrix || '[]')[0] != null
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: thekevinscott/put-it-out-there@v0
        with: { command: publish }
```

The full three-job (plan → build → publish) workflow is what `putitoutthere init` writes. See [the workflow spec](/guide/concepts#the-loop).

## Versioning — which ref to use

The action is distributed as a bundled JavaScript action. The bundle (`dist-action/index.js`) is built and committed only onto release tag commits — never onto `main`. Pick your ref accordingly.

| Ref | When to use |
|---|---|
| `@v<major>` (e.g. `@v1`) | Default. A floating tag maintained by the release workflow; always points at the latest release in the major line. Most consumers want this. |
| `@putitoutthere-v<x.y.z>` (e.g. `@putitoutthere-v1.2.3`) | Exact-version pin. Useful when you need a specific build for reproducibility or to work around a regression. |
| `@<40-char-sha>` (with a `# v1.2.3` trailing comment) | Supply-chain hardening. The SHA you pin is the SHA the `v<major>` tag resolved to at the time of pinning, so automated SHA-pinning tools (Dependabot, Renovate) work normally. |

### Refs that do not work

- `@main` — the bundle is not present on `main`. The action will fail to start with `Cannot find module 'dist-action/index.js'`.
- `@<sha-of-any-main-commit>` — same reason. Only release commits carry the bundle.
- A branch on a fork that hasn't been built — to test an unpublished change, build and commit `dist-action/` onto your fork's branch first, or cut a pre-release tag.

### Floating-tag cadence

Each successful release of `putitoutthere` itself moves the `v<major>` tag to point at the new release commit. Consumers on `@v<major>` pick up fixes on the next workflow run without any change on their side, at the cost of not being byte-pinned. Use `@<sha>` if you need byte-for-byte reproducibility.
