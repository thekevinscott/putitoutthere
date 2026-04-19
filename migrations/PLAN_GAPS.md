# Plan gaps surfaced by migration audits

Findings from the per-repo migration audits. Each row is either:
- **Supported** — existing putitoutthere mode covers the pattern; the audit just confirms we don't need to change anything.
- **Gap** — feature putitoutthere needs to add; links to the follow-up issue.

| Pattern observed                                              | Status     | Follow-up              |
|---------------------------------------------------------------|------------|------------------------|
| Per-package tags instead of shared `v{version}`               | Supported  | —                      |
| `release: <bump>` trailer instead of `[no-release]` marker     | Supported  | —                      |
| Cross-language `depends_on` cascade                           | Supported  | —                      |
| Rust → Python wheels via maturin, 5-target matrix             | Supported  | —                      |
| Rust → npm via napi-rs / bundled-cli                          | Supported  | —                      |
| Pre-built binary archives (cargo-dist style)                  | Supported (`bundled-cli`) | — |
| Standalone `.tar.xz` asset on GitHub Release (curl-installable) | **Gap**    | TODO: file issue       |
| npm model / weight packages with custom cadence               | Supported  | —                      |
| `.changeset/`-driven versioning                                | Not supported; replaced by trailer | Intentional |
| Scoped npm names (`@scope/pkg`)                                | Supported  | —                      |
| Unusual target triples (e.g. `i686-*`, `armv7-*`)             | Partial (fallthrough in `targetToOsCpu`) | TODO: explicit mapping test |

## Action items

- [ ] Clone each repo listed in [`README.md`](./README.md) and fill in the TODO sections in its audit doc.
- [ ] For every **Gap** row, file an issue in this repo labeled `audit-gap` linking back to this table.
- [ ] Move confirmed-Supported patterns into `docs/guide/` so they're discoverable to other users.

## Closed gaps

(none yet)
