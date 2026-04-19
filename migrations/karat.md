# Migrating karat to putitoutthere

Practical guide for replacing `karat`'s release workflows with `putitoutthere`. Derived from a read-only audit of [`thekevinscott/karat`](https://github.com/thekevinscott/karat) at the time of writing: `pyproject.toml`, `justfile`, and `.github/workflows/{publish,patch-release,minor-release}.yml`.

**Goal:** `pip install karat` continues to work. Release cadence is preserved. Trusted publishing stays on.

---

## TL;DR

| Before (karat)                                                                | After (putitoutthere)                                 |
|-------------------------------------------------------------------------------|-------------------------------------------------------|
| 3 release workflows (`publish.yml` reusable + `patch-release.yml` + `minor-release.yml`) | 2 workflows: `release.yml` + `putitoutthere-check.yml` |
| Tag format `v{major}.{minor}.{patch}`                                         | Per-package tag `karat-v{version}`                    |
| `RELEASE_STRATEGY` repo variable + `[no-release]` commit marker               | `[putitoutthere] cadence = "<mode>"` + `release: skip` trailer |
| Push-to-main auto-release when `STRATEGY=immediate` and commit not marked    | `cadence = "immediate"` — putitoutthere handles the gate |
| Scheduled nightly cron when `STRATEGY=scheduled`                              | `cadence = "scheduled"` — cron lives in `release.yml` |
| `uv publish --trusted-publishing always` (OIDC)                               | Same; PyPI handler uses OIDC when present             |
| Tag-rollback on publish failure (3 retries, delete tag)                       | No rollback — completeness-check prevents partial publishes |

---

## Behavior changes to accept

1. **Tag format changes.** `v0.x.y` → `karat-v0.x.y`. Update any consumer that reads git tags. Unlikely — the registry-side name (PyPI `karat`) is the real contract.

2. **Release-strategy moves to config.** Today the `RELEASE_STRATEGY` repo-level variable toggles between `immediate` (release on every push to main) and `scheduled` (nightly patch). After migration, that toggle moves into `putitoutthere.toml` as `cadence = "immediate" | "scheduled"`. Changing cadence is now a code change, not a GitHub UI change — which is a feature: the cadence lives in the repo's history.

3. **`[no-release]` marker becomes `release: skip` trailer.** Today `patch-release.yml` checks the head-commit message for `[no-release]` to skip publishing. Putitoutthere uses the git-trailer form per plan.md §10 — `release: skip` on the merge-commit's trailer block. Update `CLAUDE.md` / `AGENTS.md` (or whichever file teaches the agent commit conventions) with the new syntax.

4. **No automatic tag rollback.** Same as curtaincall: completeness-check at §13.2 makes partial-publish failures structurally impossible. For post-push PyPI rejection (format, name collision, etc.), re-run the workflow; idempotency skips already-published versions.

---

## Target `putitoutthere.toml`

```toml
[putitoutthere]
version = 1
cadence = "immediate"            # matches RELEASE_STRATEGY=immediate — flip to "scheduled" to match the cron path

[[package]]
name          = "karat"
kind          = "pypi"
pypi          = "karat"          # unchanged PyPI name
path          = "."
paths         = [
  "karat/**",
  "pyproject.toml",
  "uv.lock",
]
build         = "hatch"          # or "setuptools" — confirm from pyproject.toml
first_version = "0.1.0"          # TODO: set to current released version
```

---

## Target `release.yml`

Same shape as curtaincall's (a single pypi package, OIDC, hatch/uv build). For `cadence = "immediate"`:

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      bump: { required: false, default: patch, type: choice, options: [patch, minor, major] }
```

Drop the `schedule:` block. Putitoutthere's cadence logic reads the trailer on the merge commit and either bumps or skips.

For `cadence = "scheduled"`: use the cron form from the curtaincall doc.

---

## Files to delete after migration

```
.github/workflows/publish.yml
.github/workflows/patch-release.yml
.github/workflows/minor-release.yml
```

Keep `build.yml`, `docs.yml`, `lint.yml`, `pr-monitor.yml`, `test.yml`, `typecheck.yml` — they're orthogonal CI.

---

## Step-by-step migration plan

1. Update PyPI Trusted Publisher to reference `release.yml`.
2. `npx putitoutthere init --cadence immediate`.
3. Write `putitoutthere.toml`; confirm `build =` matches what `pyproject.toml` actually uses.
4. Update the agent-instruction file to use `release: skip` instead of `[no-release]`.
5. Create transitional tag `karat-v{current-version}` → same SHA as the latest `v{current-version}`.
6. If `pyproject.toml` uses `hatch-vcs`, update its `tag-pattern` to `karat-v*` (see curtaincall.md for the snippet).
7. Remove `RELEASE_STRATEGY` repo variable from Settings → Variables.
8. PR with `release: skip` in the trailer; merge.

---

## Verification checklist

- [ ] `pip install karat=={new-version}` installs successfully.
- [ ] Tag `karat-v{new-version}` exists and GitHub Release page is populated.
- [ ] Next merge-commit with `release: patch` produces the expected bump.
- [ ] `release: skip` on a merge-commit is respected (no release fires).
- [ ] `putitoutthere doctor` reports OIDC-only (no `PYPI_API_TOKEN` needed).

---

## Decisions locked in vs. left open

**Locked in:**
- PyPI registry name `karat` is unchanged.
- Default cadence = `immediate` (matching the strategy currently in use, per the audit notes).
- OIDC trusted publishing stays on.

**Left open:**
- Which cadence ultimately ships is a repo-owner preference. The config supports both; picking one makes the default explicit.

---

## Plan gaps surfaced

- [x] **Supported:** `[no-release]` → `release: skip` mapping covered by plan.md §10.3 trailer grammar.
- [x] **Supported:** `RELEASE_STRATEGY` → `[putitoutthere] cadence` mapping covered by plan.md §9.
- [ ] **Potential:** karat's reusable `publish.yml` retries 3× with 15s backoff before failing. Putitoutthere's retry policy (plan.md §13.3, issue #10) is 3 attempts with 1s/2s/4s exponential backoff. Slightly different; document the semantics change in release notes.
