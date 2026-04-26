# Multi-package npm workspace

This page is for repos that ship **multiple npm packages from one
workspace** — `@scope/core` + `@scope/parser` + `@scope/runtime`,
or any family of sibling packages published under one repo. No
native code, no per-platform families — just plain npm packages
that happen to live together.

`putitoutthere` orchestrates the publish ordering: cascading a
change to `@scope/core` through every package that depends on it,
publishing them in topological order, and cutting a tag per
package.

## What piot covers

| Responsibility                                                                | piot   | Your workflow |
|-------------------------------------------------------------------------------|--------|---------------|
| Decide which packages ship on a given merge (cascade via `depends_on`)        | ✅     |               |
| Topologically order the publishes (dependencies first)                        | ✅     |               |
| Compute the next version from a commit trailer                                | ✅     |               |
| Rewrite `version` in each package's `package.json`                            | ✅     |               |
| OIDC trusted publishing to npm, per package                                   | ✅     |               |
| `npm publish --provenance` per package                                        | ✅     |               |
| Skip-if-already-published idempotency per package                             | ✅     |               |
| Cut a tag per package (`{name}-v{version}`)                                   | ✅     |               |
| Update inter-package version pins in `package.json` (e.g. `"@scope/core": "0.4.1"`) |  | ⚠️ — see gotchas |
| Build each package (`tsc`, `tsup`, etc.)                                      |        | ✅            |
| Install Node + your package manager                                           |        | ✅ ([runner prereqs](/guide/runner-prerequisites)) |
| Register the trusted-publisher policy on npm per package (one-time)           |        | ✅            |

## Package boundaries are declared, not discovered

piot has [no workspace auto-detection](/guide/gaps). You declare
one `[[package]]` per package you want piot to publish. Workspace
members **not** in `putitoutthere.toml` are ignored — convenient
for repos that include private/internal packages
(`@scope/internal-fixtures`, `@scope/eslint-config`) that should
never hit npm.

This also means piot doesn't read your `pnpm-workspace.yaml` /
`workspaces` field — those govern install-time resolution, not
publish-time orchestration. Keep them in sync manually.

## Configuration shape

One `[[package]]` per published package, with `depends_on`
tracing the inter-package dependency graph:

```toml
[putitoutthere]
version = 1

[[package]]
name = "scope-core"
kind = "npm"
npm  = "@scope/core"
path = "packages/core"
paths = ["packages/core/**"]

[[package]]
name = "scope-parser"
kind = "npm"
npm  = "@scope/parser"
path = "packages/parser"
paths = ["packages/parser/**"]
depends_on = ["scope-core"]

[[package]]
name = "scope-runtime"
kind = "npm"
npm  = "@scope/runtime"
path = "packages/runtime"
paths = ["packages/runtime/**"]
depends_on = ["scope-core", "scope-parser"]
```

A change inside `packages/core/` cascades all three; a change
only inside `packages/runtime/` ships just that one. piot's
`name` is the internal identifier; the published name lives in
`npm = "@scope/…"` and can carry any scope or scoping convention
you like.

## Workflow shape

The build job runs once per package on the matrix; the publish
job runs once and walks the topological order:

```yaml
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
    - name: Install workspace
      run: pnpm install --frozen-lockfile
    - name: Build
      run: pnpm --filter ${{ matrix.name }} build
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
```

The `pnpm --filter <name>` step in the build job runs only the
planned package's build, not the whole workspace — important
when only one package needs to ship.

## One-time prerequisites before your first release

1. Register a trusted publisher on npm for **every published
   package name**. npm trust policies are per-package; a policy
   on `@scope/core` doesn't cover `@scope/parser`. Use pending
   publishers for brand-new package names.
2. Declare `[package.trust_policy]` on each `[[package]]` so the
   engine flags missing or misconfigured policies before the
   publish runs.
3. Delete any long-lived `NPM_TOKEN` repo secret once OIDC works
   for every package.

## Gotchas specific to this shape

- **Inter-package version pins are yours to manage.** When piot
  bumps `@scope/core` to `0.4.1`, it rewrites
  `packages/core/package.json` but **does not** update
  `packages/parser/package.json`'s `"@scope/core": "0.4.0"` line.
  npm publishes succeed regardless, but consumers reading
  `package.json` see a stale pin. Either use workspace protocol
  (`"@scope/core": "workspace:*"`) and let your package manager
  resolve at publish time, or update the pin yourself before the
  piot step.
- **`workspace:*` resolution at publish time.** pnpm and yarn
  rewrite `workspace:*` to a real version when packing. piot
  publishes the rewritten tarball, so this works — but the
  rewrite happens at `pnpm pack` / `pnpm publish` time, not
  `pnpm build`. Your build job needs to produce the published
  tarball (e.g. `pnpm pack --pack-destination=dist`), not just
  the compiled JS. Otherwise piot uploads the wrong contents.
- **Per-package trust policies multiply.** With N packages,
  you'll register N trust policies, N pending-publisher rows in
  the npm UI. Easy to miss one for a brand-new sibling. The engine
  flags missing policies on the next publish.
- **Per-package tags multiply too.** Each merge that cascades
  all N packages produces N tags. If consumers grep your tag
  list, this can be noisy; that's the cost of per-package
  versioning.
- **Provenance + workspace dependencies.** npm's `--provenance`
  flag inspects the build environment to attest the package's
  origin. If your `pnpm pack` step runs in a job whose
  `id-token: write` permission isn't set, provenance is silently
  disabled. The `permissions:` block at the top of the example
  workflow above sets it; a stray `permissions: read-all`
  anywhere up the chain breaks it.

## Further reading

- [Single-package npm library](/guide/shapes/npm-library) — if
  you only ship one package.
- [Cascade](/guide/cascade) — how `depends_on` and `paths`
  interact to decide what ships.
- [npm platform packages](/guide/npm-platform-packages) — if
  any of your sibling packages ship native code.
- [Configuration reference](/guide/configuration).
- [Runner prerequisites](/guide/runner-prerequisites).
