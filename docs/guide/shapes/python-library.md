# Single-package Python library

This page is for projects that ship **one Python package to PyPI**
from a single `pyproject.toml` — no Rust core, no napi, no
cross-compilation. The most common Python-library shape on PyPI.

If that's your repo, `putitoutthere` covers every step from "merge to
`main`" through "the new version is on PyPI." This page is the
end-to-end walkthrough.

## What piot covers

| Responsibility                                                                 | piot   | Your workflow |
|--------------------------------------------------------------------------------|--------|---------------|
| Decide when to ship (on every merge, or on a schedule)                         | ✅     |               |
| Compute the next version from a commit trailer or default patch-bump           | ✅     |               |
| Rewrite `[project].version` in `pyproject.toml` (static-version projects)      | ✅     |               |
| OIDC trusted publishing to PyPI                                                | ✅     |               |
| Skip-if-already-published idempotency (`GET` PyPI before upload)               | ✅     |               |
| Run `twine upload`                                                             | ✅     |               |
| Cut a git tag + GitHub Release                                                 | ✅     |               |
| Run `uv build` (or `python -m build`) for sdist / wheel                        |        | ✅            |
| Install Python and twine on the publish runner                                 |        | ✅ ([runner prereqs](/guide/runner-prerequisites)) |
| Register the trusted-publisher policy on PyPI (one-time, out-of-CI)            |        | ✅            |
| Set `SETUPTOOLS_SCM_PRETEND_VERSION_FOR_<PKG>` for dynamic-version projects    |        | ✅ ([dynamic versions](/guide/dynamic-versions)) |

## Configuration shape

A single `[[package]]` entry. For a single-package repo, pick
`tag_format = "v{version}"` so your release tags stay on the
`v0.2.13`-style timeline most Python projects already use — piot's
default is `{name}-v{version}`, which works for polyglot monorepos
but forks a new tag timeline in single-package repos.

```toml
[putitoutthere]
version = 1

[[package]]
name       = "my-lib"
kind       = "pypi"
path       = "."                            # pyproject.toml at repo root
paths      = ["src/**", "pyproject.toml"]
tag_format = "v{version}"                   # single-package shape: no name prefix
```

### Static vs. dynamic version

Two supported setups:

- **Static version.** `pyproject.toml` has a literal
  `version = "x.y.z"` under `[project]`. piot rewrites this line
  before `uv build` runs, and the built sdist carries the correct
  version. No extra wiring needed.

- **Dynamic version** (`hatch-vcs`, `setuptools-scm`, or similar).
  `pyproject.toml` declares `[project].dynamic = ["version"]` and the
  build backend derives the version from git tags. piot detects this
  and **does not** rewrite `pyproject.toml` — the build backend owns
  the computation. You need to pass the planned version to the build
  backend via an env var; see [dynamic versions](/guide/dynamic-versions)
  for the full recipe. Without this, the sdist ships as
  `<pkg>-X.Y.Z.devN.tar.gz` instead of `<pkg>-X.Y.Z.tar.gz`.

## Workflow shape

The release workflow runs three phases internally
(`plan → build → publish`). For this shape, the build phase needs
Python + `build`, and the publish phase needs Python + `twine`.
The example below is a hand-written `release.yml` from the prior
model; once the reusable workflow lands, the consumer file
collapses to a few `uses:` lines.

```yaml
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: release
  cancel-in-progress: false

permissions:
  contents: read
  id-token: write

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
        with:
          command: plan

  build:
    needs: plan
    if: fromJSON(needs.plan.outputs.matrix || '[]')[0] != null
    strategy:
      fail-fast: false
      matrix:
        include: ${{ fromJSON(needs.plan.outputs.matrix) }}
    runs-on: ${{ matrix.runs_on }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: astral-sh/setup-uv@v3
      - name: Build sdist
        working-directory: ${{ matrix.path }}
        # If your project uses dynamic versioning, set
        # SETUPTOOLS_SCM_PRETEND_VERSION_FOR_<PKG> here. See
        # /guide/dynamic-versions.
        run: uv build --sdist
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact_name }}      # source of truth — do not substitute
          path: ${{ matrix.artifact_path }}      # source of truth — do not substitute

  publish:
    needs: [plan, build]
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - name: Install twine
        run: pip install twine
      - name: Configure git identity
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
      - uses: actions/download-artifact@v4
        with: { path: artifacts }
      - uses: thekevinscott/putitoutthere@v0
        with:
          command: publish
        env:
          PYPI_API_TOKEN: ${{ secrets.PYPI_API_TOKEN }}   # optional, fallback only
```

::: tip Use `matrix.artifact_name` / `matrix.artifact_path` verbatim
Those two fields are emitted by the `plan` job and read by the
`publish` job's completeness check. **Do not substitute your own
glob** (`dist/`, `dist/*.tar.gz`). `uv build --sdist` writes to
`dist/` inside `matrix.path`, which is exactly what
`matrix.artifact_path` already references; passing the matrix value
through keeps the contract intact. See [artifact contract](/guide/artifact-contract)
for the full naming grammar and a worked diagnosis when the publish
job reports `missing artifact directory <X>/`.
:::

## Publish job prerequisites

The scaffolded `publish` job assumes OIDC plus a Node runtime. For
this shape, it also needs:

- **Python on PATH** (`actions/setup-python@v5`).
- **`twine` installed** (`pip install twine`). piot's PyPI handler
  shells out to `twine upload`; without it, the job fails with
  `spawn twine ENOENT`.
- **A git committer identity.** piot cuts an annotated tag
  (`git tag -a`), which needs `user.name` + `user.email`. Hosted
  runners don't set these; configure `github-actions[bot]` before the
  piot step.

See [runner prerequisites](/guide/runner-prerequisites) for the
cross-shape reference.

## One-time prerequisites before your first release

1. Register a [trusted publisher](/guide/auth#pypi) on PyPI for your
   project. For a brand-new project with no existing release, use a
   [pending publisher](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/)
   to skip the bootstrap token.
2. Declare the expected workflow in `[package.trust_policy]` so
   the engine catches a rename mismatch before the publish tries:

   ```toml
   [package.trust_policy]
   workflow    = "release.yml"
   environment = "release"     # optional; include if your PyPI trust
                               # policy pins an environment
   ```

3. Delete any long-lived `PYPI_API_TOKEN` repo secret once OIDC is
   working, so nothing can accidentally fall back.

## Gotchas specific to this shape

- **Starting a new tag timeline by accident.** piot's default
  `tag_format` is `{name}-v{version}`. For a repo that already ships
  as `v0.2.12`, leaving the default starts a parallel
  `my-lib-v0.2.13` timeline. Set `tag_format = "v{version}"` in
  `putitoutthere.toml` to keep the existing shape.
- **`.devN` releases on PyPI.** If your `pyproject.toml` uses
  `dynamic = ["version"]` and you *don't* pass the planned version to
  the build backend, the sdist is named from the latest git tag + N
  commits and ends up as `<pkg>-0.2.13.dev<N>.tar.gz`. See
  [dynamic versions](/guide/dynamic-versions) for the env-var handoff.
  PyPI doesn't allow hard-delete; yank the bad pre-release via the
  project's Release history page.
- **Empty `PYPI_API_TOKEN` secret shadowing OIDC.** piot treats an
  empty-string env var as unset, so an un-configured secret won't
  shadow OIDC. Still — once OIDC is working, delete the repo secret.
- **`pypi` name vs. piot `name`.** If your piot package name differs
  from the PyPI project name (say you renamed on the registry), set
  `pypi = "<actual-pypi-name>"` on the `[[package]]` block. piot uses
  it for both the `isPublished` GET and the PyPI project URL.

## Further reading

- [Getting started](/getting-started) — if you haven't run `init` yet.
- [Configuration reference](/guide/configuration) — every field in
  `putitoutthere.toml`.
- [Authentication](/guide/auth) — PyPI trusted publisher setup.
- [Runner prerequisites](/guide/runner-prerequisites) — twine, git
  identity, and other non-obvious runner needs.
- [Dynamic versions](/guide/dynamic-versions) — the env-var handoff
  for `hatch-vcs` / `setuptools-scm`.
- [Polyglot Rust library](/guide/shapes/polyglot-rust) — if you also
  ship a Rust crate and/or a napi npm package from the same repo.
