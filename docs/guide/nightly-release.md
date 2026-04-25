# Nightly release

Ship a patch every night whenever there are unreleased commits — without writing a `release:` trailer on every fix.

## How it works

putitoutthere doesn't own the cron; your GitHub Actions workflow does. The workflow fires on a schedule, invokes `putitoutthere plan`, and publishes whatever the plan contains:

- If files changed inside a package's `paths` since the last tag, the package cascades and ships at `patch`.
- If nothing changed, the plan is empty and the workflow is a no-op.

No trailer is required. [Trailers](./trailer.md) remain available for explicit `minor`/`major` bumps or `skip` on the rare merge you don't want released — they just aren't load-bearing for nightly patching.

## Workflow

```yaml
name: Nightly release

on:
  schedule:
    - cron: '0 9 * * *'   # 09:00 UTC daily
  workflow_dispatch: {}    # manual "ship now" button

permissions:
  id-token: write          # OIDC for crates.io / PyPI / npm
  contents: write          # tag push + GitHub Release

jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.plan.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # full history so last-tag lookup works
      - id: plan
        uses: thekevinscott/putitoutthere@v0
        with:
          command: plan

  build:
    needs: plan
    if: needs.plan.outputs.matrix != ''
    # … your existing build job, fanning out over the matrix …

  publish:
    needs: [plan, build]
    if: needs.plan.outputs.matrix != ''
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/download-artifact@v4
        with: { path: artifacts, pattern: '*', merge-multiple: true }
      - uses: thekevinscott/putitoutthere@v0
        with:
          command: publish
```

The `matrix != ''` guard skips `build` and `publish` on quiet nights — plan emits an empty matrix when there's nothing to release.

## Testing a change to this workflow

A PR that only touches `.github/workflows/release.yml` won't cascade any package and won't cut a release — which is correct, but it means the PR that updates the release pipeline is the one PR that can't self-test on merge. See [testing your release workflow](./testing-your-release-workflow) for the three tiers of validation (`plan --json` locally, `workflow_dispatch` + `dry_run`, and a deliberate test commit).

## Combining with trailer-driven bumps

Nightly cron and trailer-driven releases compose — they're the same pipeline, different triggers. Push a commit with `release: minor` and the next cron (or a manual `workflow_dispatch`) bumps minor across cascaded packages. Most commits won't carry a trailer, and those ship at `patch` on the next cron.
