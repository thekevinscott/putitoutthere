# Manual release via `release_packages`

**Summary.** `release.yml` gained an optional `release_packages`
`workflow_call` input. When set, it triggers a manual release of an
explicit list of packages, bypassing change detection entirely. The
motivating case: putitoutthere ships a release-pipeline bug, the bug is
fixed, and downstream consumers must re-release the affected packages
even though their own repos have no new commits since the last tag —
the change-detected path emits an empty matrix in that state and cannot
release. The input value is a comma-separated list of
`name[@<bump|version>]` entries; each entry is a package name optionally
suffixed with `@<patch|minor|major>` (bump the last tag) or an explicit
`@<X.Y.Z>` semver (used verbatim). A bare name defaults to a patch bump.
Only the named packages are planned — no `depends_on` cascade, no
change-detected packages pulled in.

**Required changes.** None — the input is optional and defaults to
empty, which leaves the normal change-detected release path unchanged.
To get a manual-release button, wire the input to a `workflow_dispatch`
trigger in your caller `release.yml`:

| Before | After |
|--------|-------|
| <pre>on:<br>  push: { branches: [main] }<br><br>jobs:<br>  release:<br>    uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0</pre> | <pre>on:<br>  push: { branches: [main] }<br>  workflow_dispatch:<br>    inputs:<br>      release_packages:<br>        description: 'Comma-separated name[@bump\|version] list'<br>        required: true<br><br>jobs:<br>  release:<br>    uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0<br>    with:<br>      release_packages: ${{ inputs.release_packages }}</pre> |

The push-triggered run passes an empty `release_packages` (the `inputs`
context is empty outside `workflow_dispatch`), so the normal path keeps
working.

**Deprecations removed.** None.

**Behavior changes without code changes.** None. The new behavior is
gated entirely on the new input being non-empty.

**Verification.** Trigger the workflow from the Actions tab with
`release_packages` set to a known package (e.g. `lib-core@patch`).
Confirm the plan job's matrix contains exactly that package and the
publish job tags and publishes it at the expected version.
