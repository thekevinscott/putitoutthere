# `status`: registry-vs-tag drift report

**Summary.** New read-only command `putitoutthere status` reports, per
package, whether the latest git tag matches the registry's latest
published version, flagging drift — notably `published, untagged` (a
version live on the registry but missing its tag, which strands the
package). Reads public registry metadata only; no auth.

**Required changes.** None. Additive — a new command.

**Deprecations removed.** None.

**Behavior changes without code changes.** None — new surface.

**Verification.** Run `status` over a repo with a published-but-untagged
package: that package shows `published, untagged` and `status --check`
exits non-zero; a fully in-sync repo shows every package `in sync` and
exits zero. `--json` emits the same rows as JSON.
