# Preflight: manifest repository URL must match GITHUB_REPOSITORY; private repos rejected

**Summary.** Two new preflight checks address the
"surprise-at-publish" failure mode where a manifest's declared
`repository` URL silently disagrees with the GitHub repository the
workflow is actually running from. npm's provenance verification
returns a 422 (`"package.json: repository.url is X, expected to
match Y from provenance"`) **after** the artifact has been uploaded
and the registry has done OIDC negotiation — the kind of mid-publish
surprise this engine's "no release surprises" design commitment
exists to prevent. The same risk lives on the crates.io / PyPI
trusted-publisher paths against `Cargo.toml [package].repository`
and `pyproject.toml [project.urls]`. Both checks now fire at the
preflight stage before any side effects.

A second new check refuses to publish from a **private** GitHub
repository entirely. Provenance attestations embed a public
source-ref pointer that consumers cannot dereference when the repo
is private; the same source-visibility expectation underpins the
trusted-publisher story across all three registries. Hard-failing
at preflight beats silently shipping a verification-broken artifact.

**Required changes.** None for any consumer whose manifest URLs
already point at the correct `owner/repo` on GitHub and whose
repository is public. The check is opt-out only by fixing the
underlying disagreement.

| Failure mode                                                          | Fix                                                                                                                                                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PIOT_REPO_URL_MISMATCH` on a renamed repo, manifests stale.          | Update the manifest URL to match the GitHub repo (recommended), or rename the GitHub repo so the slugs line up. Re-run the release.                                                                                |
| `PIOT_REPO_URL_MISMATCH` on a manifest that points at a fork or mirror. | Point the manifest URL at the canonical GitHub repo the workflow runs from. Trusted-publisher records on every registry bind to the workflow source, not the fork.                                                 |
| `PIOT_REPO_PRIVATE` on a repository that is intentionally private.    | This engine cannot publish from a private repository. Either flip the repo to public before releasing or use a different release path. There is no opt-out flag — provenance attestations require public source.   |

**Deprecations removed.** None.

**Behavior changes without code changes.** None — both checks are
new gates.

**Verification.** From a PR branch with a deliberately-wrong
`repository.url`, the PR-time `check.yml` job now reports
`[PIOT_REPO_URL_MISMATCH]` naming both the declared and expected
`owner/repo` slugs and the manifest path. From a private repo,
`publish` aborts before any side effect with `[PIOT_REPO_PRIVATE]`.
Both checks no-op outside a GHA context (when `GITHUB_REPOSITORY`
is unset), so a local `putitoutthere check` from a developer
machine does not false-positive.
