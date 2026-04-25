# Release trailer

The trailer is **optional**. putitoutthere already knows how to release on its own: if a commit changed a file inside a package's `paths`, that package cascades and ships at `patch`. The trailer exists to override that default — bump `minor`/`major`, skip a release entirely, or scope a bump to specific packages.

If you just want "patch whenever something changes," you don't need to write a trailer at all. Nightly cron workflows lean on this — see the [nightly release recipe](./nightly-release.md).

## Grammar

```
release: <bump> [pkg1, pkg2, ...]
```

- `<bump>` is one of: `patch`, `minor`, `major`, `skip`.
- `[...]` is an optional list of package names to scope the bump to.
- Package names must match `^[A-Za-z0-9][A-Za-z0-9._-]*$` (the same character set npm, crates.io, and PyPI accept). Spaces, slashes, and leading hyphens are rejected.
- The line is matched anywhere in the commit body and tolerates leading whitespace, so trailers indented inside a fenced code block or quoted reply still count. If a commit has multiple `release:` lines, the **last one wins** — handy for amending an earlier hint without rewriting history.

## Semantics

| Trailer                        | What happens                                                                 |
|--------------------------------|------------------------------------------------------------------------------|
| *none*                         | Every cascaded package releases at `patch`.                                   |
| `release: minor`               | Every cascaded package releases at `minor`.                                   |
| `release: major`               | Every cascaded package releases at `major`.                                   |
| `release: skip`                | No release this merge. Cascade ignored.                                       |
| `release: minor [a, b]`        | `a` and `b` bump `minor`. Other cascaded packages bump `patch`. Unlisted-and-uncascaded packages are force-included into the plan at the listed bump. |

## Examples

Feature work on the crate:

```
feat: add parser

release: minor
```

Breaking change in one package only; unrelated package still patched:

```
refactor: rework python API

release: major [my-py]
```

Docs-only change that shouldn't release anything:

```
docs: fix typo

release: skip
```
