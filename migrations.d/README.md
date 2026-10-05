# Migration fragments

One file per public-surface change, added in the PR that makes it. This
folder *is* the migration record. Every change to public API gets one,
additive changes as well as breaking ones, because versioning is not yet
strictly semver. Filenames follow `YYYY-MM-DD-<slug>.md` (UTC merge date;
conventions in [`../changelog.d/README.md`](../changelog.d/README.md)), and
fragments are never deleted or rewritten. Notes for releases before #730
stay in [`../MIGRATIONS.md`](../MIGRATIONS.md).

Each fragment opens with a `#` title and has five sections, in order:

1. **Summary** — one paragraph: what changed and why.
2. **Required changes** — before/after for config, reusable workflow
   inputs, and consumer-side YAML. "None" if purely additive.
3. **Deprecations removed** — anything previously warned about that's now
   gone. "None" if nothing was removed.
4. **Behavior changes without code changes** — same API, different runtime
   behavior (tag format, exit codes, retry semantics, default values).
5. **Verification** — what the consumer can observe to confirm the upgrade
   worked, with expected output.
