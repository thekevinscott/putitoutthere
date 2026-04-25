# Troubleshooting publish failures

Error-string-keyed index of common publish-job failures. Every entry
gives you the literal message piot prints, the underlying cause, and
the fix. If your error isn't here, the [Known gaps](/guide/gaps)
page enumerates the deliberately-unsupported failure modes.

## "Artifact completeness check failed: missing artifact directory"

```
putitoutthere: Artifact completeness check failed:
  <pkg>: <slot>: missing artifact directory <expected-dir>/
```

**Cause.** piot's pre-publish completeness check ran in the publish
job, looked under `artifacts/<expected-dir>/`, and found nothing. One
of three things broke upstream:

1. The build job uploaded under a different `name:` than
   `matrix.artifact_name`.
2. The build job's `path:` pointed at an empty or wrong directory
   (build silently produced no files, or wrote them somewhere else).
3. The publish job's `actions/download-artifact@v4` step doesn't have
   `path: artifacts` (or has a per-name override that isolates each
   artifact under a different root).

**Fix.** Walk the [diagnosing a missing-artifact error](/guide/artifact-contract#diagnosing-a-missing-artifact-error)
checklist in the artifact-contract page. The simplest version:

- In your build job, replace any hand-rolled `name:` / `path:`
  values on `actions/upload-artifact@v4` with the
  `matrix.artifact_name` and `matrix.artifact_path` fields the plan
  job emits — those are the source of truth. See the [artifact
  contract](/guide/artifact-contract#use-matrix-artifact-name-and-matrix-artifact-path-verbatim)
  for the canonical snippet.
- If you're using `build_workflow` delegation, look up the expected
  name in the [naming convention reference](/guide/artifact-contract#naming-convention-reference).

The `<expected-dir>` value in the error is the encoded directory
piot expects (a single flat path under `artifacts/`). Forward slashes
in `pkg.name` are encoded to `__` because
`actions/upload-artifact@v4` forbids `/` in artifact names — a
package named `py/cachetta` produces `py__cachetta-sdist/`, not
`py/cachetta-sdist/`. See [artifact contract → notes](/guide/artifact-contract#naming-convention-reference)
for the encoding rule.

## "The artifact name is not valid: ... Contains the following character: Forward slash /"

```
The artifact name is not valid: py/cachetta-sdist.
Contains the following character: Forward slash /
```

**Cause.** `actions/upload-artifact@v4` rejects `/` in the `name:`
parameter. On piot versions prior to the fix for [#230](https://github.com/thekevinscott/putitoutthere/issues/230),
the planner emitted `artifact_name` verbatim from `pkg.name`, so a
package called `py/cachetta` produced an invalid upload-artifact name.

**Fix.** Upgrade the piot Action to a version that includes the
sanitization fix; the planner now encodes `/` to `__`
(`py/cachetta` → `py__cachetta-sdist`) and the build job's
`name: ${{ matrix.artifact_name }}` works without modification. No
config or workflow changes are required on the consumer side; just
keep using `${{ matrix.artifact_name }}` and `${{ matrix.artifact_path }}`.

If you can't upgrade immediately, the pre-fix workaround is to
encode `/` to `__` in the upload step and decode `__` back to `/`
on the publish side before piot's reader runs — see
[cachetta#26](https://github.com/thekevinscott/cachetta/pull/26)
for the pattern. Remove the workaround once you upgrade; otherwise
double-encoding produces `py____cachetta-sdist`.

## "spawn twine ENOENT" / "twine not found on PATH"

```
pypi: twine not found on PATH (ENOENT).
Did the publish job run `pip install twine` before the piot step?
```

**Cause.** piot's PyPI handler shells out to `twine upload`. Hosted
GitHub runners don't ship twine; the publish job has to install it.

**Fix.** Add `actions/setup-python@v5` and `pip install twine` to the
publish job before the piot step. See [runner prerequisites →
PyPI](/guide/runner-prerequisites#pypi-twine-python).

## "spawn cargo ENOENT"

**Cause.** Same shape as the twine case, on a self-hosted runner that
doesn't have `cargo` installed.

**Fix.** Add `dtolnay/rust-toolchain@stable` (or equivalent) to the
publish job. Hosted GitHub runners ship `cargo` preinstalled; this
only bites on self-hosted runners or container-based jobs.

## OIDC publish fails with HTTP 400 / "trusted publisher mismatch"

Symptoms vary per registry. The shape:

- **PyPI:** `HTTPError: 400 Bad Request` from the OIDC token exchange,
  with a body referencing workflow / environment / repository claims.
- **crates.io:** `401 Unauthorized` with a `trusted publisher policy
  rejected the OIDC token` message.
- **npm:** `403 Forbidden` from the npm publish call after the OIDC
  exchange ostensibly succeeded.

**Cause.** All three registries pin the *caller* workflow filename
(and optionally the environment) in the trust-policy JWT claim. If
you migrated from a hand-rolled `patch-release.yml` to piot's
scaffolded `release.yml`, the claim no longer matches. piot's `init`
won't update the registry side — that's a one-time out-of-band step.

**Fix.** Two options:

1. **Re-register the trusted publisher** against the new workflow
   filename (and environment, if you set one).
2. **Rename the scaffolded workflow** to match the existing trust
   policy. If you go this route, declare it in
   `[package.trust_policy]` so `doctor` catches drift on the next
   migration:

   ```toml
   [package.trust_policy]
   workflow    = "patch-release.yml"
   environment = "release"
   ```

`doctor` diffs the declared workflow against the local file and (in
CI) against `GITHUB_WORKFLOW_REF`. With the block in place, the
mismatch surfaces *before* the publish call, not after. See
[Authentication → Declaring trust-policy expectations](/guide/auth#declaring-trust-policy-expectations).

## "Please tell me who you are" / "fatal: unable to auto-detect email address"

```
*** Please tell me who you are.
fatal: unable to auto-detect email address
```

**Cause.** piot cuts an annotated tag (`git tag -a -m …`) per
successful publish, which requires a committer identity. Hosted GitHub
runners don't set one by default.

**Fix.** Configure `git config user.name` and `user.email` before the
piot step. See [runner prerequisites → git committer identity](/guide/runner-prerequisites#git-committer-identity).

## "publish: GitHub Release creation failed" (warning, not failure)

**Cause.** The piot step finished publishing to the registry and
created the git tag, but the subsequent GitHub Release creation
(`gh release create` equivalent) failed — usually a missing
`contents: write` permission, or a transient API hiccup.

**Fix.** Confirm the publish job has `permissions: contents: write,
id-token: write`. The publish itself succeeded — the registry has the
new version and the git tag is in place. The missing piece is just
the human-readable Release page; create it manually or re-run the
release job, which will short-circuit the publish via idempotency and
retry the Release creation.

## "Plan was empty, no packages cascaded"

Not strictly an error — the workflow ran, plan computed an empty
matrix, build + publish were skipped. Common when:

- The PR / commit didn't touch any file inside a `[[package]].paths`
  glob.
- A `release: skip` trailer was present.
- The `paths` globs are wrong. Run
  [`putitoutthere plan --json`](/api/cli#plan) locally to inspect.

If you *expected* a release, the most likely cause is a `paths`
mismatch — files outside the declared globs don't cascade. Double-
check the globs against `git diff --name-only origin/main` for the
range you care about.

## A green PR-event run did not publish anything

Not an error either — this is intentional. The check workflow
(`putitoutthere-check.yml`) and the release workflow on
`pull_request` events both deliberately skip the publish job. A
green workflow run on a PR validates that the plan computes and the
build steps work; it does **not** ship anything.

The signal of a real release is a **tag push** (`{name}-v{version}`,
or your `tag_format`) plus a GitHub Release on the Releases page.
Workflow-run success on a PR event is necessary but not sufficient.

See [Concepts → What runs on which event](/guide/concepts#what-runs-on-which-event)
for the matrix.

## Sdist named `<pkg>-X.Y.Z.devN.tar.gz` instead of `<pkg>-X.Y.Z.tar.gz`

**Cause.** Your `pyproject.toml` uses `[project].dynamic = ["version"]`
(hatch-vcs / setuptools-scm), and the build backend derived the
version from git instead of from piot's plan.

**Fix.** Set `SETUPTOOLS_SCM_PRETEND_VERSION_FOR_<PKG>` (or the
maturin equivalent) on the **build** job, before `uv build` /
`python -m build` runs. See [dynamic versions](/guide/dynamic-versions)
for the recipe.

PyPI doesn't allow hard-delete; yank the `.devN` release via the
project's Release history page after fixing the env var.

## Empty `PYPI_API_TOKEN` / `NPM_TOKEN` shadowing OIDC

**Cause.** Almost never the cause, but worth noting: piot treats an
empty-string env var as unset, so an unset secret will not shadow
OIDC. If both OIDC and a long-lived token are configured, OIDC wins.

**Fix.** Once OIDC is working, delete the long-lived secret
(`PYPI_API_TOKEN`, `NPM_TOKEN`, `CARGO_REGISTRY_TOKEN`) from the
repo so a future bug or an accidental fall-through can't reach for
it.

## Related

- [Artifact contract](/guide/artifact-contract) — what files piot
  expects on disk.
- [Runner prerequisites](/guide/runner-prerequisites) — the
  one-time setup that prevents most first-release failures.
- [Authentication](/guide/auth) — OIDC trust policy registration,
  per registry.
- [Testing your release workflow](/guide/testing-your-release-workflow) —
  how to validate a pipeline change before the next natural release.
- [Known gaps](/guide/gaps) — failure modes piot deliberately doesn't
  paper over.
