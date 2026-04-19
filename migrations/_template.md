# Migrating <REPO> to putitoutthere

Practical guide for replacing `<REPO>`'s hand-rolled release tooling with `putitoutthere`. Derived from an audit of `<REPO>`'s current workflows (<TODO: list `.github/workflows/*.yml`>) and release scripts (<TODO: list scripts under `scripts/` or similar>) at the time of writing.

**Goal:** refactor is a no-op for end users. Install commands continue to work, versions continue to move forward, release cadence is preserved.

---

## TL;DR

| Before (`<REPO>`) | After (`putitoutthere`) |
|---|---|
| <TODO: count workflows + lines> | ~60 lines of workflow YAML |
| <TODO: release scripts + tests> | Deleted; logic is internal to `putitoutthere` |
| <TODO: tag format> | Per-package `{name}-v{version}` tags |
| <TODO: release signal> | `release: <bump>` git trailer |
| <TODO: any custom build orchestration> | Handled by `build = "<mode>"` |

---

## Behavior changes to accept

<TODO: enumerate observed differences — tag format, trailer grammar, retry semantics, etc. Follow the `dirsql.md` structure.>

---

## Target `putitoutthere.toml`

```toml
[putitoutthere]
version = 1
cadence = "immediate"  # TODO confirm

[[package]]
name = "<TODO>"
kind = "<crates|pypi|npm>"
path = "<TODO>"
paths = ["<TODO>"]
# build = "<TODO: napi|bundled-cli|maturin|setuptools|hatch>"
# targets = ["<TODO triples>"]
# depends_on = ["<TODO>"]
```

---

## Target `release.yml`

<TODO: adapt `putitoutthere init`'s output to match the repo's build toolchain.>

---

## Files to delete after migration

- `.github/workflows/<TODO>.yml`
- `scripts/<TODO>.py`
- <...>

---

## Step-by-step migration plan

1. `npx putitoutthere init --cadence <TODO>`.
2. Copy-paste this doc's `putitoutthere.toml` into the repo.
3. Remove the deleted-files listed above.
4. Dry-run: `putitoutthere plan --dry-run --json` to verify the matrix.
5. Open a PR with the `release: minor` trailer; watch the PR-check dry-run.
6. Merge; verify the first real release works end-to-end.

---

## Verification checklist

- [ ] Install commands return the expected version across registries.
- [ ] Tags land as `{name}-v{version}`.
- [ ] GitHub Release body includes commit subjects since the last tag.
- [ ] Cascade fires for the expected packages on a test commit.
- [ ] No regressions in install time / package size on sampled platforms.

---

## Decisions locked in vs. left open

**Locked in:**
- <TODO>

**Left open:**
- <TODO>

---

## Plan gaps surfaced

- [ ] <TODO: or "none" — every pattern observed maps onto an existing putitoutthere mode.>
