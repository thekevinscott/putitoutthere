# Plan gaps surfaced by migration audits

Findings from the per-repo migration audits. Each row is either:
- **Supported** — existing putitoutthere mode covers the pattern; the audit just confirms we don't need to change anything.
- **Gap** — feature putitoutthere needs to add; links to the follow-up issue.

| Pattern observed                                                                 | Status     | Follow-up              |
|----------------------------------------------------------------------------------|------------|------------------------|
| Per-package tags instead of shared `v{version}`                                 | Supported  | —                      |
| `release: <bump>` trailer instead of `[no-release]` / `[skip-version]` markers  | Supported  | —                      |
| Cross-language `depends_on` cascade                                             | Supported  | —                      |
| Rust → Python wheels via maturin, 5-target matrix                               | Supported  | —                      |
| Rust → npm via napi-rs / bundled-cli                                            | Supported  | —                      |
| Pre-built binary archives (cargo-dist style)                                    | Supported (`bundled-cli`) | —       |
| Standalone `.tar.xz` asset on GitHub Release (curl-installable)                 | **Gap**    | TODO: file issue       |
| npm model / weight packages with custom cadence                                 | Supported  | —                      |
| `.changeset/`-driven versioning                                                 | Not supported; replaced by trailer | Intentional |
| Scoped npm names (`@scope/pkg`)                                                 | Supported  | —                      |
| Unusual target triples (e.g. `i686-*`, `armv7-*`)                               | Partial (fallthrough in `targetToOsCpu`) | TODO: explicit mapping test |
| `hatch-vcs` dynamic version from git tags                                       | Supported  | **Verify** putitoutthere's `hatch` build mode doesn't overwrite a dynamic version declaration — see curtaincall.md "Plan gaps surfaced" |
| `RELEASE_STRATEGY` repo-variable toggle                                         | Supported (maps to `[putitoutthere] cadence`) | — |
| Sibling monorepo packages with common parent glob (`models/**`, `packages/*/{javascript,python}`) | Supported (each `[[package]].paths` narrows with its own prefix) | Ensure cascade tests cover "sibling under common parent" explicitly |
| Auto-patch on every push unless `[skip-version]` marker (gbnf)                  | Supported (`cadence = "immediate"` + trailer-or-default-bump) | — |
| Slash-separated tag prefixes (`js/pkg-v*`, `py/pkg-v*`)                         | **Gap** (putitoutthere enforces `{name}-v*` with dash separator) | Low priority — only matters if an operator wants to preserve the exact historical prefix; document as a migration change-of-behavior |
| Auto tag-rollback on publish failure (uv / pnpm publish retry-and-delete-tag)   | Intentionally not supported | Completeness-check (plan.md §13.2) prevents the partial-publish class that made rollback necessary |
| Manual-only releases (no CI at all — UpscalerJS)                                | Supported (first automated release) | — |
| Repo-local `prepublishOnly` build/lint/test guards                              | Supported (moved into `release.yml` build step) | Safe to leave redundant hook in place |
| Retry policy differences (3× with 15s backoff vs. putitoutthere's 1s/2s/4s exponential) | Acceptable (documented difference) | Mention in release notes at cutover |

## Action items

- [x] Clone each repo listed in [`README.md`](./README.md) and fill in the TODO sections in its audit doc (all 6 repos audited via public GitHub read).
- [ ] For every **Gap** row above, file an issue in this repo labeled `audit-gap` linking back to this table.
- [ ] Move confirmed-Supported patterns into `docs/guide/` so they're discoverable to other users (candidates: scoped tag prefixes, trailer-driven bumps, dual-language monorepos, hatch-vcs interop).

## Closed gaps

(none yet)

## Gap issues to file

These get one `audit-gap` issue each:

1. **Standalone `.tar.xz` binary asset on GitHub Release.** Some consumers want a curl-installable tarball (cargo-dist style) in addition to registry publishes. Putitoutthere creates GitHub Releases (plan.md §15) but doesn't attach standalone archive assets for non-`bundled-cli` handlers. Link: dirsql migration doc, §6 "Decisions confirmed at migration time" already deferred this.

2. **Explicit target-triple mapping test.** `targetToOsCpu` in `src/handlers/npm-platform.ts` falls through for unusual triples (`i686-*`, `armv7-*`). Add a test matrix covering every triple putitoutthere might emit, including the long-tail cases, and a clear error message for triples it doesn't handle.

3. **Dynamic-version interop with hatch-vcs / setuptools-scm.** When `pyproject.toml` declares `version` as dynamic, putitoutthere's pypi handler must not overwrite the field. Verify + add a fixture at `test/fixtures/python-pure-hatch-vcs/` if not already covered.

4. **(Low priority) Per-package `tag_prefix` override.** If an operator wants to preserve a historical `js/pkg-v*` shape instead of the uniform `{name}-v*`, we'd need a config knob. Cachetta + gbnf both change prefix shapes at migration — defer unless users push back.
