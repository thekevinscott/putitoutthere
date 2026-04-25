# Migrating curtaincall to putitoutthere

Practical guide for replacing `curtaincall`'s release workflows with `putitoutthere`. Derived from a read-only audit of [`thekevinscott/curtaincall`](https://github.com/thekevinscott/curtaincall) at the time of writing: `pyproject.toml`, `justfile`, and `.github/workflows/{publish,patch-release,minor-release}.yml`.

**Goal:** refactor is a no-op for end users. `pip install curtaincall` continues to work, the nightly patch cadence is preserved, trusted publishing stays on.

---

## TL;DR

| Before (curtaincall)                                                   | After (putitoutthere)                                 |
|------------------------------------------------------------------------|-------------------------------------------------------|
| 3 release workflows (`publish.yml` reusable + `patch-release.yml` nightly cron + `minor-release.yml` dispatch) | 2 workflows: `release.yml` + `putitoutthere-check.yml` |
| `bump_type` input on the reusable workflow (`patch` / `minor`)        | `release: <bump>` trailer on the merge commit          |
| Tag format `v{major}.{minor}.{patch}`                                  | Per-package tag `curtaincall-v{version}`              |
| Version computed by parsing `v*.*.*` via git-tag grep                  | Version computed by putitoutthere (last-tag + bump)   |
| `uv publish --trusted-publishing always` (OIDC)                        | Same — PyPI handler uses OIDC when available         |
| Automatic tag-rollback on publish failure (3 retries, then delete tag) | No rollback — putitoutthere's artifact-completeness check (§13.2) prevents partial publishes structurally |
| Nightly cron `0 2 * * *` in `patch-release.yml`                        | `[putitoutthere] cadence = "scheduled"` + cron in `release.yml` |

---

## Behavior changes to accept

1. **Tag format changes.** `v0.3.0` → `curtaincall-v0.3.0`. Since `hatch-vcs` reads the latest tag to derive the dynamic version in `pyproject.toml`, the tag pattern passed to `hatch-vcs` must update from `v*` to `curtaincall-v*` (see `[tool.hatch.version]` in `pyproject.toml`).

2. **Release signal moves to a trailer.** Today, the operator runs `workflow_dispatch` on `minor-release.yml` for minor bumps; patch bumps happen on the nightly cron. After migration, a merge commit with `release: minor` explicitly requests the minor bump, and the scheduled cadence handles patch automatically. This makes the release intent visible in git history.

3. **No automatic tag rollback.** Putitoutthere refuses to publish when artifacts are incomplete, which collapses the class of failure that made rollback necessary. For the rare "PyPI rejected after tag pushed" case, re-run the workflow: idempotency checks skip already-published versions; the failed leg retries cleanly.

4. **Scheduled cadence moves to config.** Today `patch-release.yml` hard-codes `cron: '0 2 * * *'`. After migration, `[putitoutthere] cadence = "scheduled"` + the cron expression in the emitted `release.yml` is the single source. The cadence-aware logic (skip if no new commits since last tag) is in putitoutthere.

---

## Target `putitoutthere.toml`

```toml
[putitoutthere]
version = 1
cadence = "scheduled"            # matches today's nightly patch cron

[[package]]
name          = "curtaincall"
kind          = "pypi"
pypi          = "curtaincall"    # PyPI name unchanged
path          = "."
paths         = [
  "src/curtaincall/**",
  "pyproject.toml",
  "uv.lock",
]
build         = "hatch"          # hatchling + hatch-vcs
first_version = "0.3.0"          # current version floor; future bumps computed from last tag
```

`hatch-vcs` stays in `pyproject.toml`. Its tag pattern needs a one-line tweak:

```toml
[tool.hatch.version]
source = "vcs"
tag-pattern = "^curtaincall-v(?P<version>[0-9]+\\.[0-9]+\\.[0-9]+)$"
[tool.hatch.version.raw-options]
version_scheme = "no-guess-dev"
```

---

## Target `release.yml`

Standard `putitoutthere init` output for a Python project. The critical pieces:

```yaml
on:
  schedule:
    - cron: "0 2 * * *"
  workflow_dispatch:
    inputs:
      bump: { required: false, default: patch, type: choice, options: [patch, minor, major] }

jobs:
  plan:
    # ... putitoutthere@v0 with command: plan
  build:
    needs: plan
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }                # hatch-vcs needs full history
      - uses: astral-sh/setup-uv@v5
      - run: uv build                            # sdist + wheel
      - uses: actions/upload-artifact@v4
  publish:
    needs: [plan, build]
    permissions: { id-token: write, contents: write }
    steps:
      - uses: actions/download-artifact@v4
      - uses: thekevinscott/putitoutthere@v0
        with: { command: publish }
```

No `PYPI_API_TOKEN` — the PyPI Trusted Publisher configuration stays in place; putitoutthere's PyPI handler uses OIDC when `ACTIONS_ID_TOKEN_REQUEST_TOKEN` is present.

---

## Files to delete after migration

```
.github/workflows/publish.yml
.github/workflows/patch-release.yml
.github/workflows/minor-release.yml
```

Keep:
- `pyproject.toml` (with the updated `tag-pattern`).
- `justfile` (task runner; orthogonal to release).
- `mkdocs.yml`, `docs/` (docs pipeline is separate).

---

## Step-by-step migration plan

1. Update PyPI Trusted Publisher configuration to reference the new workflow filename `release.yml` (not `publish.yml`).
2. `npx putitoutthere init --cadence scheduled`.
3. Write the `putitoutthere.toml` above.
4. Update `[tool.hatch.version] tag-pattern` in `pyproject.toml` to match `curtaincall-v*`.
5. Create one transitional tag `curtaincall-v0.3.0` pointing at the same commit as today's `v0.3.0` (so `hatch-vcs` finds it on first build after migration).
6. Open a PR; `putitoutthere-check.yml` dry-runs.
7. Merge with a `release: skip` trailer so the cutover itself doesn't trigger a release.
8. Wait one nightly cycle and verify.

---

## Verification checklist

- [ ] `pip install curtaincall=={new-version}` installs successfully.
- [ ] Tag `curtaincall-v{new-version}` exists on the repo.
- [ ] GitHub Release page exists with auto-generated notes.
- [ ] `python -c "import curtaincall; print(curtaincall.__version__)"` reports the new version (hatch-vcs picked up the new tag pattern).
- [ ] Nightly cron fires at 02:00 UTC; no-op if no commits; patch if there are.
- [ ] No `PYPI_API_TOKEN` fallback triggered (confirmed by `putitoutthere doctor` reporting OIDC-only).

---

## Decisions locked in vs. left open

**Locked in:**
- PyPI registry name stays `curtaincall`.
- Scheduled cadence preserved (nightly patch at 02:00 UTC).
- OIDC trusted publishing stays on — no token fallback in the target workflow.

**Left open:**
- `hatch-vcs` tag-pattern change creates a one-time discontinuity. If anyone has a local checkout that predates the tag rewrite, their `uv sync` might compute a different dev version. Low-risk (single contributor) but worth flagging.

---

## Plan gaps surfaced

- [x] **Supported:** hatch-vcs dynamic version; putitoutthere's pypi handler writes the new version into the source of truth (`pyproject.toml` static field or skips writing if the file uses dynamic versioning from tags). The hatch-vcs case is covered by the `build = "hatch"` mode.
- [ ] **Verify:** confirm putitoutthere's `hatch` build mode doesn't try to rewrite `pyproject.toml`'s `version` field when `[project.dynamic] version` is declared. If it does, that's a gap — file an issue.
