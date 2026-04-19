# Migrating gbnf to putitoutthere

Practical guide for replacing `gbnf`'s 36-workflow release mesh with `putitoutthere`. Derived from a read-only audit of [`thekevinscott/gbnf`](https://github.com/thekevinscott/gbnf) at the time of writing: `pnpm-workspace.yaml`, `packages/`, and `.github/workflows/`.

**Goal:** `npm i gbnf` / `pip install gbnf` continue to work, plus the sibling packages (`json2gbnf`, `sql2gbnf`). The release graph collapses from 36 workflow files to 2.

---

## TL;DR

| Before (gbnf)                                                                | After (putitoutthere)                                 |
|------------------------------------------------------------------------------|-------------------------------------------------------|
| 36 workflow files: per-package `{lang}-{pkg}-{publish,release,test,version}.yaml` + `{lang}-shared-*` reusable workflows | 2 workflows: `release.yml` + `putitoutthere-check.yml` |
| Version bumping: auto-patch-on-push unless `[skip-version]` in commit message | `release: <bump>` trailer on merge commit            |
| Tag formats: `{lang}/{pkg}-v*` (e.g., `js/gbnf-v*`, `py/gbnf-v*`, `js/json2gbnf-v*`, `js/sql2gbnf-v*`) | Per-package tags `{name}-v*` uniformly                 |
| Version bump type hardcoded to `patch`                                       | Bump type comes from trailer (`patch`/`minor`/`major`) |
| `pnpm publish --provenance --access public` (OIDC) for JS                    | Same — npm handler uses `--provenance` with OIDC      |
| PyPI via shared workflow (OIDC inferred from `id-token: write` comment)      | PyPI handler uses OIDC when available                 |
| `[skip-version]` commit marker                                               | `release: skip` trailer                               |

---

## Behavior changes to accept

1. **Minor/major bumps become possible.** Today gbnf only produces patch bumps. The `version-type: 'patch'` value is hard-coded in the shared version workflow. After migration, `release: minor` and `release: major` work on merge commits. This is a strict capability gain.

2. **Tag prefixes collapse from slashes to dashes.** `js/gbnf-v*` → `gbnf-js-v*` (and so on for every sibling). Script any tag-reading tooling to handle both temporarily.

3. **One `release.yml` replaces the 36-workflow mesh.** The 4 "shared" workflows (`js-shared-*`, `py-shared-*`) get subsumed into putitoutthere's plan/build/publish job shape. The per-package `{lang}-{pkg}-*` workflows all become rows in putitoutthere's matrix.

4. **Commit marker changes.** `[skip-version]` → `release: skip` trailer.

5. **Per-package cadence preserved via scoped trailers.** `release: patch [gbnf-js, json2gbnf-js]` bumps only those two packages. Full-cascade releases on every push stay possible by omitting the trailer and relying on path-based cascade (plan.md §11).

---

## Target `putitoutthere.toml`

```toml
[putitoutthere]
version = 1
cadence = "immediate"            # matches current "patch on every push" behavior

# --- gbnf core ---

[[package]]
name         = "gbnf-js"
kind         = "npm"
npm          = "gbnf"
path         = "packages/gbnf/javascript"
paths        = ["packages/gbnf/javascript/**"]

[[package]]
name         = "gbnf-py"
kind         = "pypi"
pypi         = "gbnf"
path         = "packages/gbnf/python"
paths        = ["packages/gbnf/python/**"]
build        = "hatch"           # TODO: confirm from pyproject.toml

# --- json2gbnf ---

[[package]]
name         = "json2gbnf-js"
kind         = "npm"
npm          = "json2gbnf"       # TODO confirm registry name
path         = "packages/json2gbnf/javascript"   # TODO confirm directory shape
paths        = ["packages/json2gbnf/javascript/**"]
depends_on   = ["gbnf-js"]

[[package]]
name         = "json2gbnf-py"
kind         = "pypi"
pypi         = "json2gbnf"       # TODO confirm
path         = "packages/json2gbnf/python"
paths        = ["packages/json2gbnf/python/**"]
build        = "hatch"
depends_on   = ["gbnf-py"]

# --- sql2gbnf (JS only, per observed workflows) ---

[[package]]
name         = "sql2gbnf-js"
kind         = "npm"
npm          = "sql2gbnf"        # TODO confirm
path         = "packages/sql2gbnf"  # TODO: path depends on whether sql2gbnf has a javascript/ subdir
paths        = ["packages/sql2gbnf/**"]
depends_on   = ["gbnf-js"]
```

**`test-writer` is not declared.** The audit saw only `js-test-writer-test.yaml` — no `publish` workflow — suggesting it's an internal dev tool. Confirm before removing from the workspace.

**`js-shared-*` / `py-shared-*` aren't packages.** Those are reusable workflows in the old setup, not publishable units. In the new world they disappear.

---

## Target `release.yml`

The build step needs branches for npm + pypi:

```yaml
- uses: pnpm/action-setup@v4
- uses: actions/setup-node@v4
  with: { node-version: 20, cache: pnpm }

- if: matrix.kind == 'npm'
  run: |
    pnpm install --frozen-lockfile
    pnpm --filter "./${{ matrix.path }}" run build

- if: matrix.kind == 'pypi'
  uses: astral-sh/setup-uv@v5
- if: matrix.kind == 'pypi'
  working-directory: ${{ matrix.path }}
  run: uv build
```

Publish job `id-token: write`, no token env block once trusted publishers are configured for each registry-name in the matrix above.

---

## Files to delete after migration

All 34 of these:

```
.github/workflows/js-gbnf-publish.yaml
.github/workflows/js-gbnf-release.yaml
.github/workflows/js-gbnf-version.yaml
.github/workflows/js-json2gbnf-publish.yaml
.github/workflows/js-json2gbnf-release.yaml
.github/workflows/js-json2gbnf-version.yaml
.github/workflows/js-shared-build.yaml
.github/workflows/js-shared-publish.yaml
.github/workflows/js-shared-release.yaml
.github/workflows/js-shared-version.yaml
.github/workflows/js-sql2gbnf-publish.yaml
.github/workflows/js-sql2gbnf-release.yaml
.github/workflows/js-sql2gbnf-version.yaml
.github/workflows/py-gbnf-publish.yaml
.github/workflows/py-gbnf-release.yaml
.github/workflows/py-gbnf-version.yaml
.github/workflows/py-json2gbnf-publish.yaml
.github/workflows/py-json2gbnf-release.yaml
.github/workflows/py-shared-build.yaml
.github/workflows/py-shared-publish.yaml
.github/workflows/py-shared-release.yaml
.github/workflows/py-shared-version.yaml
```

Keep: all `*-test.yaml`, `*-lint.yaml`, `*-integration-test.yaml`, `*-unit-test.yaml`, `docs-build.yaml`, `pr-monitor.yaml` (orthogonal CI).

---

## Step-by-step migration plan

1. Confirm which packages actually publish to registries (the audit identified `gbnf`, `json2gbnf`, `sql2gbnf` per their publish workflows; confirm each registry name against `package.json` / `pyproject.toml`).
2. Configure npm + PyPI Trusted Publishers for each registry-name, workflow `release.yml`.
3. `npx putitoutthere init --cadence immediate`.
4. Write `putitoutthere.toml` per above; resolve the TODOs by reading each package's manifest.
5. Create transitional tags for every publishable unit, pointing at the current head of each:
   - `gbnf-js-v{current}` → same SHA as `js/gbnf-v{current}`
   - `gbnf-py-v{current}` → same SHA as `py/gbnf-v{current}`
   - (similar for `json2gbnf-js`, `json2gbnf-py`, `sql2gbnf-js`)
6. Update `CLAUDE.md` / `AGENTS.md` — replace `[skip-version]` with `release: skip`.
7. PR with `release: skip` trailer to cut over.
8. Merge. Verify via a small follow-up PR that a trailer-driven release produces the expected tags + GitHub Releases.

---

## Verification checklist

- [ ] `npm view gbnf version` / `pip install gbnf=={new}` both resolve.
- [ ] Sibling packages (`json2gbnf`, `sql2gbnf` on npm; `json2gbnf` on PyPI) resolve at their new versions.
- [ ] `release: minor` produces a minor bump (capability gbnf didn't have before).
- [ ] A Rust-core-like change to `packages/gbnf/javascript` cascades to `json2gbnf-js` and `sql2gbnf-js` via `depends_on`.
- [ ] No residual references to the 34 deleted workflows in `README.md` / contributor docs.

---

## Decisions locked in vs. left open

**Locked in:**
- Registry names unchanged across all siblings.
- Tag prefixes adopt the dash convention (`{name}-v*`).
- `--provenance` stays on for every npm publish.

**Left open:**
- **`test-writer`.** Not publishable (no publish workflow observed) — confirm it's internal, then it stays out of `putitoutthere.toml` but remains in `pnpm-workspace.yaml`.
- **Python json2gbnf.** Verify the directory actually exists at `packages/json2gbnf/python` before declaring that block.
- **Scoped vs unscoped npm names.** The audit didn't check whether `sql2gbnf` is actually at that name on npm; confirm against `packages/sql2gbnf/.../package.json`.

---

## Plan gaps surfaced

- [x] **Supported:** multi-package monorepo with cross-language siblings (one `[[package]]` per unit, `depends_on` for cascade).
- [x] **Supported:** `release: skip` replaces `[skip-version]` (plan.md §10).
- [x] **Supported:** `--provenance` via OIDC.
- [ ] **Capability gain**, not a gap: minor/major bumps via trailer (gbnf's old setup was patch-only).
- [ ] **Potential:** gbnf ships TypeScript bindings with no native code — but if a future rust-core package is added to this monorepo, `depends_on` from `gbnf-js` / `gbnf-py` should include it. Confirm the shape if/when that happens.
