# Auto-heal refuses to tag HEAD over unreleased changes (#776)

**Summary.** When `publish` finds the planned version already live with
no tag, auto-heal (#407) tagged HEAD. HEAD is often not the commit that
was uploaded: if a release uploaded `0.0.9` but never tagged it, the next
merge plans `0.0.9` again, finds it live, and tags the new merge, whose
changes are on no registry. No registry records which commit a version
was built from. So auto-heal now tags HEAD only when the package content
can't differ, meaning at most one commit since the package's last tag
touches the package (its globs, or a `depends_on` package's). Otherwise
`publish` fails.

**Required changes.** None. No config key, workflow input, or trailer
changes.

**Deprecations removed.** None.

**Behavior changes without code changes.** A `publish` run that plans an
already-published, untagged version while more than one commit since the
package's last tag touches the package now exits non-zero with
`[PIOT_HEAL_UNRELEASED_CHANGES]`, naming `<name>@<version>`. Before, it
tagged HEAD and exited `0`. No tag is written. To recover, tag the commit
that was actually published, either by hand
(`git tag -a <name>-v<version> <sha> && git push origin <name>-v<version>`)
or by running `putitoutthere reconcile --expect <name>@<version>` from a
checkout of that commit, then rerun the release. The next run plans the
following version and ships the unreleased changes.

A rerun after a multi-commit push can hit this even when HEAD was the
published commit. The same recovery applies.

The single-commit case (a run uploads, dies before tagging, and its rerun
heals the tag) is unchanged.

**Verification.** Leave a version live but untagged, merge another change
to the package, and run a release. Before: the log shows
`already published; skipping`, then `pushing tag` onto the new merge, and
the job passes. After: the job fails with `[PIOT_HEAL_UNRELEASED_CHANGES]`
and no tag is pushed.
