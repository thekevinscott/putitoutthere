# npm: an unregistrable name is diagnosed as a name, not a missing token

**Summary.** npm's registry refuses to *create* a package name that
collapses onto an existing one under its moniker rule — names are
compared with punctuation (`-`, `_`, `.`) stripped and case folded, so a
live `will-run` makes a new `willrun` impossible to register. Scoped
names (`@scope/willrun`) are exempt. The refusal arrives as an
auth-shaped `E403 Forbidden`, and on a first publish it satisfies every
condition the #598 `NODE_AUTH_TOKEN` bootstrap hint checks, so
putitoutthere reported it as the bootstrap case: an operator was sent to
debug credentials for a name that no credential can create (issue #617 —
four release runs and two fresh granular tokens before a rename fixed it
on the first try).

`publish` now matches npm's `Package name too similar to existing
package …` prose before it reaches the bootstrap branch and fails with
`PIOT_NPM_NAME_TOO_SIMILAR`, naming the remedy and quoting npm's own
line. The same PR stops the failure dump from discarding subprocess
output (see **Behavior changes** below).

**Required changes.** None. If a release was previously failing with the
bootstrap hint on a brand-new npm package and a fresh `NPM_TOKEN` did
not help, re-run it: you will now get the real reason. When it is this
one, the fix is on your side and it is a rename — change both the
`[[package]].name` (or the `npm` override) in `putitoutthere.toml` and
the `name` in `package.json`:

| Before | After |
| --- | --- |
| ```toml
[[package]]
name = "willrun"
kind = "npm"
``` | ```toml
[[package]]
name = "@your-scope/willrun"
kind = "npm"
``` |

Scoping is the change that always works, because scoped names are exempt
from the rule; picking a different unscoped name works too, if it does
not collide with anything either.

**Deprecations removed.** None.

**Behavior changes without code changes.** Three, all in what a failed
publish *reports* — no config, no inputs, no artifacts change:

1. An npm publish refused for the moniker rule now fails with
   `PIOT_NPM_NAME_TOO_SIMILAR` and a rename/scope remedy, where it
   previously surfaced either the `NODE_AUTH_TOKEN` bootstrap hint (on a
   first publish) or a bare `npm publish failed` stderr dump. Ordinary
   `E403`s are unaffected: the publish-over race still short-circuits to
   already-published, and a genuine first-publish bootstrap still gets
   its hint.
2. The bootstrap hint now carries npm's raw stderr underneath it. The
   hint infers its diagnosis from the *absence* of the package on the
   registry, never from the registry's stated reason, so the evidence
   has to travel with it for a reader to check it.
3. The `$GITHUB_STEP_SUMMARY` failure dump reports the failing
   subprocess's real argv, exit status, stdout and stderr instead of
   `command: ""`, `exitCode: -1` and a paraphrase of the stderr. Anyone
   grepping a run log or a job summary for `exitCode` will see a real
   status where a `-1` sentinel used to be.

**Verification.** On a package whose name is blocked, a release run
fails with `::error::npm/<pkg> [PIOT_NPM_NAME_TOO_SIMILAR]: …` in the
run-summary annotation strip, and the job summary's **stderr** block
shows npm's `403 … Package name too similar to existing package <other>`
rather than putitoutthere's own sentence. For any failed publish, the
summary's **Command** block now names the command that ran
(`npm publish --access=public …`) and **Exit code** shows the tool's own
status.
