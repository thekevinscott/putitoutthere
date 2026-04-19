# Migrating cachetta to putitoutthere

Practical guide for replacing `cachetta`'s dual-language release workflows with `putitoutthere`. Derived from a read-only audit of [`thekevinscott/cachetta`](https://github.com/thekevinscott/cachetta) at the time of writing: `pnpm-workspace.yaml`, `packages/{javascript,python}`, and `.github/workflows/{js,py}-{publish,release-dispatch}.yaml`.

**Goal:** `npm i cachetta` and `pip install cachetta` continue to work. The two language bindings retain independent cadences.

---

## TL;DR

| Before (cachetta)                                                         | After (putitoutthere)                                 |
|---------------------------------------------------------------------------|-------------------------------------------------------|
| 4 release workflows (`js-publish.yaml`, `js-release-dispatch.yaml`, `py-publish.yaml`, `py-release-dispatch.yaml`) | 2 workflows: `release.yml` + `putitoutthere-check.yml` |
| Per-language tags `js/cachetta-v{version}` and `py/cachetta-v{version}`  | Per-package tags `cachetta-js-v{version}` and `cachetta-py-v{version}` |
| Push to main auto-releases unless commit contains `[no-release]`         | `release: <bump>` / `release: skip` trailer            |
| npm publish via `pnpm publish --provenance` (OIDC)                       | npm handler publishes with `--provenance` when OIDC is available |
| `uv publish --trusted-publishing always` (OIDC) for PyPI                 | Same — PyPI handler uses OIDC                         |
| Tag-rollback on publish failure (both languages)                         | Completeness-check prevents partial publishes         |

---

## Behavior changes to accept

1. **Tag-prefix shape changes.** From `js/cachetta-v0.2.0` / `py/cachetta-v0.6.1` to `cachetta-js-v0.2.0` / `cachetta-py-v0.6.1`. Putitoutthere uses `{name}-v{version}` uniformly; the separator inside the name is a dash, not a slash. This keeps tag listing under `git tag | grep cachetta-` clean.

2. **Single `release.yml` drives both languages.** Today they're split across four workflows. After migration, putitoutthere's plan step emits one matrix that covers both packages; the build step branches on `matrix.kind` (`npm` vs `pypi`).

3. **Commit-message marker becomes trailer.** `[no-release]` anywhere in the message → `release: skip` as a trailer on the merge commit. Update `CLAUDE.md` / `AGENTS.md` to teach the new syntax.

4. **Per-package cadence preserved.** Both packages default to the repo-level `cadence`. If one language should release on push and the other should wait, use `release: patch [cachetta-js]` scoped-trailer form (plan.md §10.3) — list only the packages you want to release.

---

## Target `putitoutthere.toml`

```toml
[putitoutthere]
version = 1
cadence = "immediate"            # matches current "push to main auto-releases" behavior

[[package]]
name          = "cachetta-js"
kind          = "npm"
npm           = "cachetta"       # npm registry name unchanged
path          = "packages/javascript"
paths         = ["packages/javascript/**"]
first_version = "0.2.0"

[[package]]
name          = "cachetta-py"
kind          = "pypi"
pypi          = "cachetta"       # PyPI registry name unchanged
path          = "packages/python"
paths         = ["packages/python/**"]
build         = "hatch"          # TODO: confirm which Python build backend the py package uses
first_version = "0.6.1"
```

No cross-language `depends_on` — the two packages implement the same API surface independently; changes to one don't automatically cascade to the other.

---

## Target `release.yml`

Standard `putitoutthere init` output. The build step needs two branches:

```yaml
- uses: pnpm/action-setup@v4
- uses: actions/setup-node@v4
  with: { node-version: 20, cache: pnpm }

- if: matrix.kind == 'npm'
  run: |
    pnpm install --frozen-lockfile
    cd packages/javascript
    pnpm run build

- if: matrix.kind == 'pypi'
  uses: astral-sh/setup-uv@v5
- if: matrix.kind == 'pypi'
  working-directory: packages/python
  run: uv build
```

Publish job uses `id-token: write`. No token env block — both registries configure trusted publishers.

---

## Files to delete after migration

```
.github/workflows/js-publish.yaml
.github/workflows/js-release-dispatch.yaml
.github/workflows/py-publish.yaml
.github/workflows/py-release-dispatch.yaml
```

Keep orthogonal workflows: `docs.yaml`, `js-build.yaml`, `js-lint.yaml`, `js-test.yaml`, `pr-monitor.yaml`, `py-lint.yaml`, `py-test.yaml`.

---

## Step-by-step migration plan

1. Configure npm Trusted Publisher for `cachetta`, workflow `release.yml`.
2. Configure PyPI Trusted Publisher for `cachetta`, workflow `release.yml`.
3. `npx putitoutthere init --cadence immediate`.
4. Write the `putitoutthere.toml` above.
5. Create transitional tags: `cachetta-js-v0.2.0` → same SHA as `js/cachetta-v0.2.0`; `cachetta-py-v0.6.1` → same SHA as `py/cachetta-v0.6.1`.
6. Update `CLAUDE.md` to teach `release: skip` (replacing `[no-release]`).
7. PR with `release: skip` trailer.
8. Merge. Verify.

---

## Verification checklist

- [ ] `npm view cachetta version` matches the new `cachetta-js-v{version}` tag.
- [ ] `pip install cachetta=={new-version}` resolves.
- [ ] Both tag shapes exist: `cachetta-js-v*`, `cachetta-py-v*`.
- [ ] Scoped-trailer `release: patch [cachetta-js]` bumps only the JS package.
- [ ] `--provenance` attestation visible on the npm package page.

---

## Decisions locked in vs. left open

**Locked in:**
- Registry names unchanged (`cachetta` on npm, `cachetta` on PyPI).
- Tag prefixes change from `js/cachetta-v*` / `py/cachetta-v*` to `cachetta-js-v*` / `cachetta-py-v*`.
- OIDC trusted publishing stays on for both registries.

**Left open:**
- **Python build backend**: the audit didn't pin down which build tool (`hatch` vs `uv` vs `setuptools`) `packages/python` uses. Confirm before writing the final config.

---

## Plan gaps surfaced

- [x] **Supported:** dual-language monorepo with independent packages (two `[[package]]` blocks, no `depends_on`).
- [x] **Supported:** npm `--provenance` via OIDC (plan.md §16.3).
- [ ] **Potential:** putitoutthere's per-package tag shape uses a dash separator inside the name. If operators want to preserve the `js/...` / `py/...` slash convention, that would require a per-package `tag_prefix` override — not in v0. Flag as a future feature request if users of this shape push back.
