# First-publish bundled-cli lockfile self-heal

**Summary.** The reusable workflow's npm install steps —
`_matrix.yml`'s build-matrix install and `release.yml`'s
publish-job rebuild (#256) — both ran strict installs (`npm ci`
or `pnpm install --frozen-lockfile`) and refused on any drift
between the committed lockfile and `package.json`. For consumers
of the bundled-cli / napi shape, drift is the *expected* state on
the first publish: `package.json` declares
`optionalDependencies` for `<name>-<triple>@<version>` platform
packages that this pipeline produces, those packages don't exist
on the registry yet, pnpm 10 silently drops 404'd optionals from
the lockfile when it is regenerated locally, and the next CI run
sees lockfile and `package.json` disagree. Hit in the wild on
`thekevinscott/darkfactory`'s first release.

Both install steps now fall back from the strict form to its
non-strict counterpart on failure (`pnpm install --no-frozen-lockfile`
/ `npm install`) and emit a `::warning::` line in the run log
naming the recovery. The README's
[Bundled-CLI npm family](../README.md#bundled-cli-npm-family)
recipe grew a `[!NOTE]` callout documenting the chicken-and-egg
and the workflow's transparent recovery.

**Required changes.** None. Consumers who were working around
the failure by gitignoring the lockfile, by suppressing
`optionalDependencies` from `package.json`, or by pinning to
older lockfile-tolerant pnpm versions can revert those
workarounds; the workflow now handles the bootstrap state on
its own.

**Deprecations removed.** None.

**Behavior changes without code changes.** Strict installs that
previously failed red on lockfile drift now succeed via the
non-strict fallback path. The build artifact is unchanged
(installs the deps `package.json` declares); only the strictness
of *how* it gets there relaxes. Healthy lockfiles still take
the strict path with no observable difference. The new
`::warning::` lines are visible in the run log on the GitHub
Actions UI but do not fail the run.

**Verification.** A bundled-cli / napi consumer's first-publish
release run completes the build matrix without manual lockfile
fiddling. The run log contains a single
`::warning::pnpm-lock.yaml drift ...` line per affected install
step (one in the build matrix, one in the publish-job rebuild)
when the strict install fails; healthy installs see no
warning.
