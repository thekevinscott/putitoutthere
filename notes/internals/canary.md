# Live canary against real registries

Tracking: [#297](https://github.com/thekevinscott/putitoutthere/issues/297).
Parent program: [#292](https://github.com/thekevinscott/putitoutthere/issues/292).
Workflow: [`.github/workflows/canary.yml`](../../.github/workflows/canary.yml).
Fixture: [`canary/`](../../canary/).

## What it is

A weekly scheduled GitHub Actions job that re-publishes two throwaway
packages against real npm and real crates.io:

- `@piot-canary/main` (npm)
- `piot-canary` (crates.io)

Each run rewrites `__VERSION__` to `0.0.${unix_seconds}` so crates.io's
immutable-publish rule never collides. The npm package publishes under
the `canary` dist-tag so the timestamp versions never touch `latest`.

The job runs the engine end-to-end (plan → build → publish → tag →
GitHub Release → verify-install) against live registries with OIDC
Trusted Publisher authentication, and exercises a real `npm install`
+ `cargo add` against the just-published artifacts to catch packument-
lag and propagation-shape regressions.

## What it catches

Regressions in `putitoutthere`'s interaction with real-registry
behavior that the per-PR Verdaccio + cargo-http-registry mocks do
not model:

- npm packument propagation lag ([#265](https://github.com/thekevinscott/putitoutthere/issues/265)).
- crates.io OIDC TP steady-state round-trip drift (token mint, claim
  validation, publish ack).
- Upstream-action major-bump auth-flow drift (e.g. a `setup-node`,
  `crates-io-auth-action`, or `gh-action-pypi-publish` upgrade
  silently changing behavior).
- Registry endpoint deprecations.
- npm CLI updates changing publish-response shape.

What it does NOT catch: regressions introduced on the day a PR lands.
The per-PR e2e fixtures
([#293](https://github.com/thekevinscott/putitoutthere/issues/293) /
[#294](https://github.com/thekevinscott/putitoutthere/issues/294) /
[#295](https://github.com/thekevinscott/putitoutthere/issues/295) /
[#296](https://github.com/thekevinscott/putitoutthere/issues/296))
carry that responsibility. The canary is a backstop with a one-week
detection latency, not a front-line gate.

## Trusted Publisher records

Registered against this repo's `canary.yml` workflow, filtered by
a dedicated `canary` GitHub Environment (separate from `release` —
which is production publishes via `release.yml` / `release-
npm.yml` — and from `e2e` — which is per-PR Verdaccio runs).

| Registry | Package | TP filename | TP environment |
| --- | --- | --- | --- |
| npm | `@piot-canary/main` | `canary.yml` | `canary` |
| crates.io | `piot-canary` | `canary.yml` | `canary` |

The TP records encode the workflow **filename**. Renaming
`canary.yml` silently invalidates trust — see AGENTS.md →
"Never rename a release-path workflow file". The canary is on the
same "do not rename" list as `release.yml`, `release-npm.yml`,
`e2e-fixture.yml`, and `e2e-fixture-job.yml`.

## Bootstrap (one-time, manual)

Trusted Publishing on npm and crates.io binds to an **already-
published** package, so the very first publish has no OIDC path
available. The bootstrap was performed manually with long-lived
tokens. Steps, for the historical record / disaster recovery:

1. **crates.io** —
   ```bash
   # On a maintainer machine, with CARGO_REGISTRY_TOKEN exported:
   cd canary/rust
   sed -i "s/__VERSION__/0.0.1/" Cargo.toml src/lib.rs
   cargo publish
   ```
   Then on crates.io's web UI, navigate to the `piot-canary` crate
   settings and add a Trusted Publisher entry: repo
   `thekevinscott/putitoutthere`, workflow `canary.yml`,
   environment `release`.
2. **npm** — register the `piot-canary` org on npmjs.com (the
   maintainer owns it). Then:
   ```bash
   # With NPM_TOKEN exported as a maintainer automation token:
   cd canary/npm
   sed -i "s/__VERSION__/0.0.1/" package.json src/index.ts
   npm install && npm run build
   npm publish --access public --tag canary
   ```
   Then on npmjs.com, navigate to the `@piot-canary/main` package
   settings → Publishing access → Add Trusted Publisher: repo
   `thekevinscott/putitoutthere`, workflow `canary.yml`,
   environment `release`.

Once both TP records are in place, the scheduled `canary.yml` run
authenticates via OIDC and the bootstrap tokens can be revoked.

## On-failure playbook

When a weekly canary fails, the first question is "is this a real
regression or a transient lag past the verify retries?"

1. **Inspect the failing step.**
   - Publish failure → either auth (OIDC TP drift, `crates-io-auth-
     action` upgraded), engine logic (engine code regressed), or
     registry-side (real registry returned 4xx). Check the auth
     step's stderr first.
   - Verify failure with `installed but version mismatch` → engine
     published a tarball, but its content lagged the planned
     version. This is the cachetta-style failure mode the post-
     publish verify exists to catch
     ([#258](https://github.com/thekevinscott/putitoutthere/issues/258),
     [#256](https://github.com/thekevinscott/putitoutthere/issues/256)).
   - Verify failure with `did not install after N attempts` →
     packument / sparse-index propagation took longer than the
     verify-step retry budget. If you can `npm install @piot-canary/main@<version>` /
     `cargo add piot-canary@=<version>` from your laptop after the
     run finished, the publish landed and the verify step needs a
     wider retry budget; that's still a regression worth filing
     (it implies real-world consumers hitting the same lag will
     fail their own CI).
2. **Confirm via the registry directly, not the workflow conclusion.**
   ```bash
   curl -sI 'https://registry.npmjs.org/@piot-canary%2Fmain'
   curl -sI 'https://crates.io/api/v1/crates/piot-canary'
   ```
   The publish status is the registry's source of truth, not the
   workflow's exit code.
3. **Re-run with the narrow toggles.** The
   `workflow_dispatch` inputs `skip_npm` and `skip_crates` let you
   isolate which registry is the regression's source without
   burning a fresh version slot on the other. crates.io has a
   per-crate 24h publish ceiling — re-running unconstrained can
   exhaust it quickly.
4. **File an issue or fix forward.** If the regression is real and
   live-registry-side, open an issue against
   `putitoutthere`. If the regression is in `putitoutthere`'s
   engine, write a per-PR test (Verdaccio / cargo-http-registry)
   that reproduces it, then fix.
