# Migrating skillet to putitoutthere

Practical guide for replacing `skillet`'s release workflows with `putitoutthere`. Derived from a read-only audit of [`thekevinscott/skillet`](https://github.com/thekevinscott/skillet) at the time of writing: `pyproject.toml`, `justfile`, `.github/workflows/{publish,patch-release,minor-release}.yml`.

**Goal:** `pip install pyskillet` continues to work (note: PyPI name is `pyskillet`, CLI entrypoint is `skillet`). Release cadence preserved. Trusted publishing stays on.

---

## TL;DR

| Before (skillet)                                                         | After (putitoutthere)                                 |
|--------------------------------------------------------------------------|-------------------------------------------------------|
| 3 release workflows (`publish.yml` reusable + `patch-release.yml` + `minor-release.yml`) | 2 workflows: `release.yml` + `putitoutthere-check.yml` |
| Tag format `v{major}.{minor}.{patch}`                                    | Per-package tag `skillet-v{version}`                  |
| `bump_type` input on reusable workflow                                   | `release: <bump>` trailer                             |
| `uv publish --trusted-publishing always` (OIDC) + `uv build`             | Same; PyPI handler uses OIDC + `uv build`            |
| Tag-rollback on failure                                                  | Completeness-check prevents partial publishes         |
| 12 total workflows; many test/lint jobs orthogonal to releases          | Release jobs consolidated; non-release jobs untouched |

---

## Behavior changes to accept

1. **Internal name vs. PyPI name.** `[[package]].name = "skillet"` is the **internal** handle used for tag prefixes (`skillet-v*`). The PyPI package name stays `pyskillet` via the `pypi =` override. The CLI entrypoint registered in `pyproject.toml` (`skillet = "skillet.cli.main:main"`) is unaffected by putitoutthere.

2. **Tag-prefix switch.** From `v0.x.y` to `skillet-v0.x.y`. Update any git-tag-reading consumers (unlikely) and, if `hatch-vcs` is used, update the tag-pattern in `pyproject.toml` (see curtaincall.md for the snippet).

3. **Trailer replaces dispatch-only minor.** Today a minor bump requires manually triggering `minor-release.yml` from the Actions UI. After migration, writing `release: minor` into the merge-commit trailer is equivalent and lives in git history.

4. **No auto tag-rollback.** Same rationale as curtaincall/karat.

---

## Target `putitoutthere.toml`

```toml
[putitoutthere]
version = 1
cadence = "scheduled"            # TODO confirm — if patch-release.yml has a cron, keep scheduled; otherwise "immediate"

[[package]]
name          = "skillet"
kind          = "pypi"
pypi          = "pyskillet"      # actual PyPI name (distinct from the internal handle)
path          = "."
paths         = [
  "skillet/**",
  "pyproject.toml",
  "uv.lock",
]
build         = "hatch"          # hatchling per pyproject.toml
first_version = "0.1.0"          # TODO set to current released floor
```

---

## Target `release.yml`

Standard single-pypi shape from `putitoutthere init`. Build step:

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: astral-sh/setup-uv@v5
- run: uv build
- uses: actions/upload-artifact@v4
```

---

## Files to delete after migration

```
.github/workflows/publish.yml
.github/workflows/patch-release.yml
.github/workflows/minor-release.yml
```

Keep: `build.yml`, `changelog.yml`, `docs.yml`, `integration.yml`, `lint.yml`, `pr-monitor.yml`, `security.yml`, `test.yml`, `typecheck.yml`. Orthogonal to the release flow.

---

## Step-by-step migration plan

Identical to karat/curtaincall — the repos are sister projects.

1. Update PyPI Trusted Publisher to reference `release.yml`.
2. `npx putitoutthere init --cadence <immediate|scheduled>`.
3. Write the `putitoutthere.toml` above; confirm the `build =` value matches what `pyproject.toml` actually uses.
4. If `pyproject.toml` uses `hatch-vcs`, update the `tag-pattern` to `skillet-v*`.
5. Create transitional tag `skillet-v{current}` → same SHA as today's `v{current}`.
6. PR with `release: skip` in the trailer.
7. Merge. Verify.

---

## Verification checklist

- [ ] `pip install pyskillet=={new-version}` installs successfully.
- [ ] `skillet --version` CLI entrypoint resolves to the new version.
- [ ] Tag `skillet-v{new-version}` exists and GitHub Release page is populated.
- [ ] Next trailer-driven release produces the expected bump.

---

## Decisions locked in vs. left open

**Locked in:**
- PyPI name stays `pyskillet`; CLI entrypoint stays `skillet`.
- Internal tag prefix `skillet-v`.

**Left open:**
- Cadence choice (`immediate` vs `scheduled`). The audit saw a `patch-release.yml` file; if it carries a cron (it likely does, matching curtaincall/karat), pick `scheduled`. If it's dispatch-only, `immediate` is simpler.

---

## Plan gaps surfaced

- [x] **Supported:** `pypi` override to decouple PyPI name from internal name (plan.md §6.4).
- [x] **Supported:** `hatch` build mode for hatchling+hatch-vcs.
- [ ] **Verify:** confirm `putitoutthere`'s pypi handler picks up a dynamic version from hatch-vcs correctly (see same note in curtaincall.md).
