# Plan gaps surfaced by migration audits

Findings from the per-repo migration audits. This table is read alongside
[`notes/design-commitments.md`](../notes/design-commitments.md), which is the
normative reference for what is and isn't in scope. Rows marked **Out of
scope** are intentional non-goals, not missing features — they are recorded
here so the decision trail stays visible to anyone comparing putitoutthere
against other release tooling. Each row is one of:

- **Supported** — existing putitoutthere mode covers the pattern; the audit just confirms we don't need to change anything.
- **Gap** — feature putitoutthere needs to add; links to the follow-up issue.
- **Out of scope** — belongs to a compositional layer (release-please, cargo-dist, the consumer's workflow); see `notes/design-commitments.md`.

For rows that touch cross-language artefact production, the Status column is
split into two axes:

- **Publish-side** — will putitoutthere correctly publish the artefact if it is handed one?
- **Build-side** — does putitoutthere generate the cross-compile matrix that produces the artefact?

Publish-side and build-side are evaluated independently because handler names
include the builder (`build = "napi"`, `build = "maturin"`) and readers
otherwise conflate the two.

| Pattern observed                                                                 | Status     | Follow-up              |
|----------------------------------------------------------------------------------|------------|------------------------|
| Per-package tags instead of shared `v{version}`                                 | Supported  | —                      |
| `release: <bump>` trailer instead of `[no-release]` / `[skip-version]` markers  | Supported  | —                      |
| Cross-language `depends_on` cascade                                             | Supported  | —                      |
| Rust → Python wheels via maturin, 5-target matrix                               | Publish-side: Supported / Build-side: Out of scope (see notes/design-commitments.md non-goal #3) | — |
| Rust → npm via napi-rs / bundled-cli                                            | Publish-side: Supported / Build-side: Out of scope (see notes/design-commitments.md non-goal #3) | — |
| Pre-built binary archives (cargo-dist style)                                    | Publish-side: Supported (`bundled-cli`) / Build-side: Out of scope (see notes/design-commitments.md non-goal #3) | — |
| Standalone `.tar.xz` asset on GitHub Release (curl-installable)                 | Out of scope (see notes/design-commitments.md non-goal #3) | — |
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

## Gap issues

Gaps are now tracked as GitHub issues: #169, #170, #171, #172.

The per-package `tag_prefix` override idea previously listed here is **Out of
scope** (see `notes/design-commitments.md` non-goal #2): tag creation and
trigger orchestration live in the consumer's workflow, not in putitoutthere's
config. Likewise, the standalone `.tar.xz` GitHub Release asset previously
listed here is **Out of scope** per non-goal #3 (cargo-dist / goreleaser
occupy that lane).
