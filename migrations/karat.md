# Migrating karat to putitoutthere

Audit draft. Full audit requires cloning and reading the actual repo. TODO markers flag the spots that need a real-repo pass.

---

## TL;DR

| Before (karat) | After (putitoutthere) |
|---|---|
| <TODO> | 2 workflows |
| <TODO> | `release: <bump>` git trailer |

---

## Behavior changes to accept

<TODO from repo audit>

---

## Target `putitoutthere.toml`

```toml
[putitoutthere]
version = 1

[[package]]
name = "karat"
kind = "npm"  # TODO confirm
path = "."
paths = ["src/**", "package.json"]
```

---

## Target `release.yml`

Use `putitoutthere init` output.

---

## Files to delete after migration

<TODO>

---

## Verification checklist

- [ ] Install returns the expected version.
- [ ] Tags land as `karat-v{version}`.

---

## Plan gaps surfaced

- [ ] <TODO after audit>
