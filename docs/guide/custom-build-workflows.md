# Custom build workflows

Sometimes piot's default build-matrix logic doesn't cover a package
you own — a bespoke 5-platform wheel build with a pre-compiled Rust
CLI staged into the Python source tree, a non-standard napi layout, a
build that depends on a specific toolchain image. For these cases,
piot's `[[package]].build_workflow` field lets you hand the build
step off to a workflow you wrote, while keeping the rest of the
piot-driven flow (plan, cascade, idempotency, publish, tag, GitHub
Release) intact.

This page is the composition pattern. If you're not sure you need it,
you probably don't — piot's default `build = "napi"` / `"bundled-cli"`
/ `"maturin"` cover most shapes. Use this knob when none of them fit.

## Declare the delegation

```toml
[[package]]
name = "my-py"
kind = "pypi"
path = "packages/python"
paths = ["packages/python/**"]
build = "maturin"
targets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
]
build_workflow = "publish-python.yml"
```

- `build_workflow` is a **bare filename**, not a path. The workflow
  must live under `.github/workflows/`.
- The field works on any `kind` (`crates`, `pypi`, `npm`).
- When set, piot's `plan` stamps `build_workflow` on every matrix row
  for that package. Your `release.yml` reads that field to decide
  whether to run piot's default build steps or delegate.

## Wire the composition in release.yml

GitHub Actions doesn't support dynamic `uses:` — a workflow reference
must be a literal string, not a matrix variable. That means piot
can't auto-wire the dispatch for you. The pattern is:

1. Your `release.yml` has piot's default `build` job for rows where
   `matrix.build_workflow == ''`.
2. A *second* build job, gated on a specific package, runs `uses:
   ./.github/workflows/<file>` statically for that package.

```yaml
jobs:
  plan:
    # scaffolded by piot
    outputs:
      matrix:                  ${{ steps.plan.outputs.matrix }}
      has_custom_python_build: ${{ steps.decide.outputs.has_custom }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - id: plan
        uses: thekevinscott/putitoutthere@v0
        with:
          command: plan
      # Split the matrix so the default build job only sees the rows
      # that don't delegate.
      - id: decide
        run: |
          m='${{ steps.plan.outputs.matrix }}'
          echo "has_custom=$(echo "$m" | jq 'any(.[]; .build_workflow == "publish-python.yml")')" >> $GITHUB_OUTPUT

  # Default piot-driven build, skipping delegated rows.
  build:
    needs: plan
    if: fromJSON(needs.plan.outputs.matrix || '[]')[0] != null
    strategy:
      fail-fast: false
      matrix:
        include: ${{ fromJSON(needs.plan.outputs.matrix) }}
    runs-on: ${{ matrix.runs_on }}
    steps:
      - if: matrix.build_workflow == ''
        # … piot's scaffolded steps (setup-rust / setup-python / etc.) …
        run: echo "default build for ${{ matrix.name }}-${{ matrix.target }}"

  # Delegated build for my-py via a consumer-owned workflow_call.
  build-my-py:
    needs: plan
    if: needs.plan.outputs.has_custom_python_build == 'true'
    uses: ./.github/workflows/publish-python.yml
    with:
      version: ${{ fromJSON(needs.plan.outputs.matrix)[0].version }}
    secrets: inherit

  publish:
    needs: [plan, build, build-my-py]
    if: always() && !failure() && !cancelled()
    # … piot's scaffolded publish job, unchanged …
```

The specifics of how to pick the version + targets out of the matrix
are yours — the matrix JSON is an array of rows, and the delegated
workflow usually just needs the planned version + the list of target
triples.

## What the delegated workflow should do

A consumer-owned `publish-python.yml` receives `version` (and
whatever else you wire) as an input and uploads build artifacts under
the `artifact_name` convention piot's `publish` job expects:

- `${pkg.name}-wheel-${target}` for per-target wheels (pypi maturin).
- `${pkg.name}-sdist` for the sdist.
- `${pkg.name}-crate` for the cargo package tarball.
- `${pkg.name}-${target}` / `${pkg.name}-main` for npm platform
  packages.

Piot's publish job calls `actions/download-artifact@v4` with the
default `path: artifacts`, so the artifacts land under
`artifacts/<artifact_name>/…` on the publish runner. As long as your
delegated workflow uploads under the right name, piot's handler picks
the files up and publishes them normally.

Inputs your delegated workflow should take:

```yaml
on:
  workflow_call:
    inputs:
      version:
        description: The planned version piot computed.
        type: string
        required: true
```

Targets, paths, and artifact names can be fixed in your delegated
workflow since it's already specific to a single package.

## Idempotency, plan, tag, and release stay piot's

`build_workflow` delegates only the **build** step. Everything else
still runs the piot way:

- `plan` decides whether the package cascades (based on the package's
  `paths` globs + the `release:` trailer).
- Pre-publish auth + artifact completeness checks run against the
  artifacts your delegated workflow uploaded.
- `handler.publish` calls the registry's publish API (twine, cargo
  publish, npm publish) using the artifacts on disk.
- The git tag + GitHub Release happen after a successful publish.

No part of piot's publish contract changes based on whether a package
used `build_workflow`. The feature is scoped to replacing the build
step, not the whole pipeline.

## When to use this vs. forking

Use `build_workflow` when:

- You have a bespoke build matrix that piot's declarative `build`
  modes don't express (pre-compiled binaries staged into a source
  tree, container-image builds, custom toolchain images).
- You want to keep the bespoke workflow as its own file so upstream
  piot updates don't touch it.
- You're okay hand-wiring the `uses:` dispatch job in `release.yml`.

Don't use it when:

- `build = "napi"` or `build = "bundled-cli"` already covers your
  shape — piot's platform-package synth is opinionated and battle-
  tested on those paths.
- Your "bespoke" step is really just a few extra shell commands —
  add them to the scaffolded build job as additional steps instead.
- You need piot to also delegate the *publish* — that's a separate
  feature under discussion; the plain `build_workflow` only hands off
  the build half.

## Related

- [Configuration reference](/guide/configuration) — every field in
  `putitoutthere.toml`.
- [Concepts](/guide/concepts) — plan → build → publish.
- [npm platform packages](/guide/npm-platform-packages) — the
  opinionated alternative for napi / bundled-cli families.
