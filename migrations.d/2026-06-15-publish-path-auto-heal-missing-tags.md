# publish-path auto-heal: missing tags

**Summary.** `putitoutthere publish` now self-heals a missing git tag: when
a version is already live on the registry but has no tag, publish writes the
tag instead of skipping silently. Previously the already-published branch
returned before tagging, so a version that reached the registry on a
half-failed run (published, then the run died before the tag step) was
stranded published-but-untagged — and because piot derives "last released"
from tags, it skipped forever and could never bump, while dependents drifted
ahead into unflagged version skew.

**Required changes.** None. Purely additive behavior on the publish path.

**Deprecations removed.** None.

**Behavior changes without code changes.** On the next release run after
upgrading, any package that is live on a registry but missing its tag has the
tag created (and pushed) at the release commit, automatically. Idempotent:
packages already correctly tagged are untouched.

**Verification.** Re-run a release on a repo with a published-but-untagged
package: the run now creates the missing tag (per the package's `tag_format`;
visible via `git tag` / on GitHub) and the package resumes normal version
bumping on later releases.
