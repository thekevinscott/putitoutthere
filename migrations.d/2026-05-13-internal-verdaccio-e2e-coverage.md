# Internal Verdaccio e2e coverage

**Summary.** Internal change with no consumer-observable impact. Adds a
`js-vanilla-first-publish` fixture and matrix row that publishes to an
in-job Verdaccio service container; the post-publish tarball-verify step
is now registry-agnostic. `PIOT_NPM_REGISTRY` is an internal e2e seam
(`src/handlers/npm.ts`, `src/handlers/npm-platform.ts`) that routes the
publish at the override registry and suppresses provenance + the
public-npm bootstrap-hint path. The reusable consumer workflow
(`release.yml`), `putitoutthere.toml` schema, and trailer grammar are
untouched. #304 (parent #293).

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** None for consumers. For
contributors running e2e locally: the publish job in
`e2e-fixture-job.yml` now spins up a Verdaccio service container per
job (~3s startup cost). First-publish fixtures route publish at
`http://localhost:4873`; steady-state fixtures keep their real-npm
path unchanged.

**Verification.** A successful CI run on `main` shows the new
`e2e (js-vanilla-first-publish)` matrix row green. The existing
`e2e (js-vanilla)` row remains green, confirming the real-npm
steady-state hasn't regressed. To demonstrate the #256 tarball-verify
contract, trigger `E2E` via `workflow_dispatch` with
`simulate_no_dist: true` — the `js-vanilla-first-publish` row should
go red on `tarball missing 'dist'`.
