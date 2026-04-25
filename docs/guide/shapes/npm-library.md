# Single-package npm library

This page is for projects that ship **one pure-JavaScript/TypeScript
package to npm** from a single `package.json` — no native addon, no
bundled CLI, no per-platform family. The most common npm-library
shape.

If that's your repo, `putitoutthere` covers every step from "merge
to `main`" through "the new version is on npm." This page is the
end-to-end walkthrough.

## What piot covers

| Responsibility                                                                 | piot   | Your workflow |
|--------------------------------------------------------------------------------|--------|---------------|
| Decide when to ship (on every merge, or on a schedule)                         | ✅     |               |
| Compute the next version from a commit trailer or default patch-bump           | ✅     |               |
| Rewrite `version` in `package.json`                                            | ✅     |               |
| OIDC trusted publishing to npm                                                 | ✅     |               |
| `npm publish --provenance`                                                     | ✅     |               |
| Skip-if-already-published idempotency (`GET` npm before publish)               | ✅     |               |
| Cut a git tag + GitHub Release                                                 | ✅     |               |
| Run `tsc`, `tsup`, `rollup`, or whatever builds your `dist/`                   |        | ✅            |
| Install Node and your package manager on the publish runner                    |        | ✅ ([runner prereqs](/guide/runner-prerequisites)) |
| Register the trusted-publisher policy on npm (one-time, out-of-CI)             |        | ✅            |

## Configuration shape

A single `[[package]]` entry with `kind = "npm"` and no `build`
field (vanilla mode — piot just runs `npm publish`). For a
single-package repo, pick `tag_format = "v{version}"` to stay on
the `v1.2.3`-style timeline most npm projects already use —
piot's default is `{name}-v{version}`, which works for polyglot
monorepos but forks a new tag timeline in single-package repos.

```toml
[putitoutthere]
version = 1

[[package]]
name       = "my-lib"
kind       = "npm"
npm        = "@scope/my-lib"               # omit for unscoped; set for scoped
path       = "."                           # package.json at repo root
paths      = ["src/**", "package.json"]
tag_format = "v{version}"                  # single-package shape: no name prefix
# access  = "public"                       # default; set "restricted" for private
# tag     = "latest"                       # default dist-tag
```

## Workflow shape

`putitoutthere init` scaffolds `release.yml` with three jobs:
`plan → build → publish`. For this shape, the build job needs Node
and your toolchain (`tsc` / `tsup` / `rollup` / etc.), and the
publish job needs Node on PATH. Minimum working example:

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
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - name: Build
        run: |
          cd ${{ matrix.path }}
          npm ci
          npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact_name }}
          path: ${{ matrix.artifact_path }}

  publish:
    needs: [plan, build]
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: https://registry.npmjs.org
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
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}     # optional, fallback only
```

## Publish job prerequisites

The scaffolded `publish` job assumes OIDC plus a Node runtime. For
this shape, it also needs:

- **`registry-url: https://registry.npmjs.org`** on
  `actions/setup-node`. Without it, `npm publish --provenance`
  can't locate the registry and the OIDC exchange fails with
  misleading auth errors.
- **A git committer identity.** piot cuts an annotated tag
  (`git tag -a`), which needs `user.name` + `user.email`. Hosted
  runners don't set these; configure `github-actions[bot]` before
  the piot step.

See [runner prerequisites](/guide/runner-prerequisites) for the
cross-shape reference.

## One-time prerequisites before your first release

1. Register a [trusted publisher](/guide/auth#npm) on npm for your
   package. Brand-new packages can use a pending publisher to skip
   the bootstrap token.
2. Declare the expected workflow in `[package.trust_policy]` so
   `doctor` catches a rename mismatch before the publish tries:

   ```toml
   [package.trust_policy]
   workflow    = "release.yml"
   environment = "release"     # optional; include if your npm trust
                               # policy pins an environment
   ```

3. Delete any long-lived `NPM_TOKEN` repo secret once OIDC is
   working, so nothing can accidentally fall back.

## Gotchas specific to this shape

- **Starting a new tag timeline by accident.** piot's default
  `tag_format` is `{name}-v{version}`. For a repo that already
  ships as `v1.2.3`, leaving the default starts a parallel
  `my-lib-v1.2.4` timeline. Set `tag_format = "v{version}"` in
  `putitoutthere.toml` to keep the existing shape.
- **Scoped package name ≠ piot `name`.** piot's `name` is the
  internal identifier; the npm name lives in `npm = "@scope/pkg"`.
  Get this wrong and the `isPublished` GET hits the wrong URL and
  piot thinks every version is "new."
- **`files` in `package.json` determines what ships.** piot
  doesn't curate your tarball; `npm publish` does. A missing
  `dist/` in `files` (or a missing `.npmignore` exclusion) is the
  most common cause of a "published, but empty" release.
- **Provenance requires `id-token: write`.** The top-level
  `permissions:` block sets it for `plan`, but jobs that inherit
  need `id-token: write` too. A stray `permissions: read-all`
  anywhere above the publish job silently disables provenance.
- **Empty `NPM_TOKEN` secret shadowing OIDC.** piot treats an
  empty-string env var as unset, so an un-configured secret won't
  shadow OIDC. Still — once OIDC is working, delete the repo secret.

## Further reading

- [Getting started](/getting-started) — if you haven't run `init` yet.
- [Configuration reference](/guide/configuration) — every field in
  `putitoutthere.toml`.
- [Authentication](/guide/auth) — npm trusted publisher setup.
- [Runner prerequisites](/guide/runner-prerequisites) — git
  identity, registry-url, and other non-obvious runner needs.
- [Rust + napi npm library](/guide/shapes/rust-napi) — if your
  package ships a native addon per platform.
- [Bundled-CLI npm family](/guide/shapes/bundled-cli) — if your
  package ships a per-platform CLI binary.
