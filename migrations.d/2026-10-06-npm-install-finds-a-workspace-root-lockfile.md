### npm install step finds a workspace-root lockfile (#721)

**Summary.** The npm build steps in `_matrix.yml` and `release.yml` now look for
`package-lock.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml` in the package
directory and its ancestors up to the checkout root. Before, a workspace member
with no lockfile of its own got a bare `npm install`.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** A workspace member now installs with
pnpm (or `npm ci`) instead of a bare `npm install`.

**Verification.** The publish job no longer fails with `wireit: not found` on a
pnpm workspace member.
