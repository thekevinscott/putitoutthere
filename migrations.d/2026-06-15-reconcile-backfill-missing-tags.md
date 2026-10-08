# reconcile: backfill missing tags

**Summary.** New command `putitoutthere reconcile` backfills the missing
git tag for every package that is live on its registry but untagged
(`status`'s `published, untagged` drift). It is the on-demand companion to
the publish-path auto-heal: auto-heal only fires for a package already in a
publish run, so a package whose globs never change again stays stuck;
`reconcile` heals it without a release. It reuses the same `computeStatus`
detection `status` reports and the same idempotent `ensureTag` the publish
path heals with — no parallel logic.

**Required changes.** None. Additive — a new command.

**Deprecations removed.** None.

**Behavior changes without code changes.** `--dry-run` is now accepted on
`reconcile` (it previews the heal without writing). It remains rejected on
`plan` / `publish`, unchanged from the #244 removal.

**Verification.** On a repo with a published-but-untagged package, run
`putitoutthere reconcile`: the missing tag is created (per the package's
`tag_format`) — pointed at a sibling package's tag commit for that version
when one exists, else `HEAD` — and pushed; `git tag` / GitHub show it, and
`status` then reports the package `in sync`. A second `reconcile` run is a
no-op. `reconcile --dry-run` reports what it would create without writing;
`--json` emits the actions.
