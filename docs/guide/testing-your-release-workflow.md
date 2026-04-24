# Testing your release workflow

You just changed `.github/workflows/release.yml` (or your `putitoutthere.toml`,
or a piot upgrade). How do you know the change works *before* the next natural
release ships?

The scaffolded workflow only publishes when a package's `paths` filter matches
files changed since the last tag. For most PRs that's exactly right —
workflow-only PRs don't cascade and don't cut a release, which is the correct
no-op. But it means the PR that *updates* the release pipeline is the one PR
that can't self-test. This page covers the options.

## Three tiers of validation

Pick the lightest one that covers your change.

### 1. Local `plan --json` — instant, no CI

Before you push, run `putitoutthere plan --json` locally against a checkout
that mimics the state you care about (usually `main` with your change
applied). You'll see:

- Which packages the plan would cascade.
- The planned version for each.
- The build matrix piot will emit.

```bash
$ putitoutthere plan --json
[]                                   # empty plan — nothing to ship
```

```bash
$ git commit -m 'x'                  # stage a hypothetical change
$ putitoutthere plan --json
[{"name": "my-lib", "kind": "pypi", "version": "0.2.14", ...}]
```

Covers: plan-level logic (paths, `depends_on` cascade, trailer parsing,
tag_format, target expansion). Does **not** cover anything in the build or
publish jobs — they don't run.

### 2. `workflow_dispatch` + `dry_run: true` — real runner, no publish

The scaffolded `release.yml` exposes a `dry_run` input:

```yaml
on:
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Dry-run: compute plan, skip publish + tag'
        type: boolean
        default: false
```

From the Actions tab, click **Run workflow** and flip `dry_run` on. The run
executes the plan job on the real runner, and if the plan is non-empty, the
build job fans out and exercises your build steps. The publish step
short-circuits before calling twine / cargo / npm and before creating a tag.

Covers: plan job + any side effects that run before the publish short-circuit
(matrix wiring, runner selection, setup-python / setup-node, artifact
upload). Does **not** cover registry calls or tag creation.

Caveat: a dry-run on an empty plan is still a no-op. Dispatching doesn't
force a cascade — if nothing changed since the last tag, the build + publish
jobs are skipped just like on a natural push.

### 3. A deliberate test commit — full end-to-end

When your change affects logic that only runs when the plan is non-empty
(most common — publish-job prereqs, env-var handoffs, tag-format changes,
idempotency behaviour), the only way to validate is to force a cascade:

```bash
# Touch a file inside a watched `paths` glob. A docstring / README bump works.
echo "" >> src/my_lib/__init__.py
git add src/my_lib/__init__.py
git commit -m "chore: validate release pipeline

release: patch"
git push origin main
```

The `release: patch` trailer is belt-and-braces — the default bump would patch
anyway, but an explicit trailer makes the intent obvious in the history.

Covers: the whole pipeline, end-to-end, against the real registries.

**Before you do this:**

- Pick a file whose "version changed for no reason" is harmless. A comment
  bump in a main-branch file is fine; do not commit to source files whose
  version bumps have consumer-visible effects.
- Make sure the upcoming version is one you're willing to ship — you cannot
  hard-delete a PyPI release, and crates.io versions are permanent (yank is
  all you get).
- If the test release is unwanted, [yank it](#yanking-unwanted-releases)
  after the fact.

## Post-release validation checklist

After the first release that exercises your change, confirm each of these in
the Actions log or the registry:

- [ ] **Plan output is what you expected.** Check the `plan` job's JSON
      output — every package you expected is in the matrix, no extras.
- [ ] **Sdist / wheel filenames.** For PyPI, verify the artifact is named
      `<pkg>-X.Y.Z.tar.gz` — **not** `<pkg>-X.Y.Z.devN.tar.gz`. A `.devN`
      suffix means a dynamic-version backend derived the version from git
      instead of from piot's plan; see [dynamic versions](./dynamic-versions).
- [ ] **Per-package `published:` log lines.** Each `[[package]]` that
      cascaded should have a `published: <name>@<version> status=published`
      line in the publish job log. `status=already-published` means piot's
      idempotency check short-circuited (fine on a re-run; suspicious on a
      fresh release).
- [ ] **Tag shape.** `git ls-remote --tags origin` should show the expected
      tag per package (`{name}-v{version}` by default, or `v{version}` if
      you set `tag_format`). A missing tag means the publish leg succeeded
      but the tag push failed — the git identity step may be misconfigured
      ([runner prerequisites](./runner-prerequisites)).
- [ ] **GitHub Release (if enabled).** Check the Releases page for the new
      tag. A failed release-notes generation surfaces as a `publish:
      GitHub Release creation failed` warning but does not fail the run.

## Yanking unwanted releases

If the test release is unwanted (wrong version, belonged on a feature
branch, etc.) — registries don't allow hard-delete, but they do allow
**yanking**, which hides the release from default resolution:

- **PyPI**: `https://pypi.org/manage/project/<name>/releases/` → find the
  release → **Options → Yank**.
- **crates.io**: `cargo yank --version X.Y.Z <crate>`.
- **npm**: `npm unpublish <name>@<version>` within 72 hours of publish;
  after that, `npm deprecate <name>@<version> "..."` is the replacement.

Yanked PyPI and crates.io releases can still be installed via exact pin
but no longer satisfy default resolution. After yanking, fix the bug and
ship the next real version — do not re-use the yanked version number.

## Related

- [Nightly release](./nightly-release) — the cron-triggered shape, same
  empty-plan semantics apply.
- [Dynamic versions](./dynamic-versions) — the `.devN` failure mode and
  the `SETUPTOOLS_SCM_PRETEND_VERSION_FOR_<PKG>` handoff.
- [Runner prerequisites](./runner-prerequisites) — the non-obvious publish-
  job setup (twine, git identity) that breaks on first release if missing.
- [CLI reference](/api/cli) — `plan --json`, `doctor`, `preflight`.
