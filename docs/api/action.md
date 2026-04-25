# GitHub Action

`thekevinscott/putitoutthere@v0` wraps the CLI for use in GitHub Actions workflows.

## Inputs

| Input            | Default | Description                                                     |
|------------------|---------|-----------------------------------------------------------------|
| `command`        | `plan`  | Any putitoutthere CLI subcommand. The action shells through to the bundled CLI; the canonical workflow values are `plan` and `publish`, with `doctor` and `preflight` useful for diagnostics. `init`, `token`, `auth`, `version` work too but are designed for local terminals, not CI. |
| `dry_run`        | `false` | (publish) Skip side effects.                                    |
| `fail_on_error`  | `true`  | Exit non-zero on failure (otherwise log + continue at 0).       |

`command` is marked optional in `action.yml` and defaults to `plan`. Passing it as an empty string (`with: { command: '' }`) is treated as missing and fails the step with `putitoutthere action: missing required input \`command\``. The action always invokes the CLI with `--json`, so JSON output applies even when calling `doctor` or `preflight` from a workflow.

## Outputs

| Output   | Description                                           |
|----------|-------------------------------------------------------|
| `matrix` | (`plan` only) JSON array describing the build matrix the `build` job fans out across. **The output key is omitted entirely** when the plan resolves to zero packages, or when `command` is anything other than `plan`. The minimal workflow below uses `\|\| '[]'` to coalesce the missing key to an empty JSON array; downstream jobs guard with `if: fromJSON(needs.plan.outputs.matrix \|\| '[]')[0] != null`. |

### Matrix row shape

Each row in `outputs.matrix` is an object the `build` and `publish` jobs read by field name. The shape is defined by the `MatrixRow` interface in `src/plan.ts`:

| Field            | Type    | Notes                                                                                |
|------------------|---------|--------------------------------------------------------------------------------------|
| `name`           | string  | Package name from `[[package]].name`.                                                |
| `kind`           | enum    | `crates` \| `pypi` \| `npm`.                                                         |
| `version`        | string  | Resolved next version for this package.                                              |
| `target`         | string  | One of: a target triple (e.g. `aarch64-apple-darwin`), `noarch` (crates and main npm packages), `sdist` (Python source distribution), or `main` (the umbrella npm package in a `napi` / `bundled-cli` family). |
| `runs_on`        | string  | GitHub Actions runner label for this row (e.g. `ubuntu-latest`, `macos-14`). Picked from the per-target mapping or the user's explicit `runner` override. |
| `artifact_name`  | string  | The `actions/upload-artifact@v4` name the `build` job uses; `publish` reads the matching artifact tree from the directory the scaffolded workflow downloads into (`artifacts/` under the runner temp dir). |
| `artifact_path`  | string  | Path that the `build` job's upload step globs.                                       |
| `path`           | string  | Package working directory (i.e. `[[package]].path`).                                 |
| `build`          | string? | Handler-specific build mode (`maturin`, `setuptools`, `hatch` for pypi; `napi`, `bundled-cli` for npm). Absent for vanilla npm and crates. |
| `build_workflow` | string? | Bare filename of a `workflow_call` workflow when `[[package]].build_workflow` is set; otherwise absent. See [Custom build workflows](/guide/custom-build-workflows). |
| `bundle_cli`     | object? | When `[package.bundle_cli]` is declared on a per-target maturin row, mirrors `bin` / `stage_to` / `crate_path` so the build job can branch on `matrix.bundle_cli.bin`. Not set on the sdist row. |

Treat the field set as additive: new optional fields may appear in matrix rows over time, but existing fields are stable.

## Release body

When `publish` cuts a tag, it also creates a GitHub Release. The body is a Markdown bullet list of commit subjects between the previous tag for the same package and the new tag, computed from `git log <prev>..<new> --format=- %s --no-merges`. Merge commits are excluded; only subject lines appear (commit bodies are already on the tag itself). On the first release for a package — when no prior tag exists — the body lists the full commit history reachable from the new tag.

Releases are marked `prerelease: true` when the tag's version contains a pre-release identifier (e.g. `1.0.0-rc.1`), per `src/release.ts`.

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
        uses: thekevinscott/putitoutthere@v0
        with: { command: plan }

  publish:
    needs: plan
    if: fromJSON(needs.plan.outputs.matrix || '[]')[0] != null
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: thekevinscott/putitoutthere@v0
        with: { command: publish }
```

The full three-job (plan → build → publish) workflow is what `putitoutthere init` writes. See [the workflow spec](/guide/concepts#the-loop).

## Versioning

Use `@v0`:

```yaml
- uses: thekevinscott/putitoutthere@v0
  with:
    command: plan
```

`v0` is a floating tag maintained by the release workflow. It advances to every new release in the `0.x.x` line automatically. You do not need to do anything to receive fixes — the next workflow run picks them up. When `putitoutthere` cuts a 1.0, the tag to use becomes `@v1`; the scaffold generated by `putitoutthere init` will be updated in lockstep.

Do not use `@main`, a branch ref, or a non-release commit SHA. The action's bundled JavaScript (`dist-action/index.js`) is built only onto release tag commits; any other ref fails with `Cannot find module 'dist-action/index.js'`. If you encounter that error, your `uses:` line is pointing at the wrong kind of ref — change it back to `@v0`.

Dependabot and Renovate will rewrite `@v0` to `@<40-char-sha> # v0.x.y` on their own schedule for supply-chain hardening. That SHA is the tag commit's SHA, so the bundle is present and the action continues to work without any change on your end.
