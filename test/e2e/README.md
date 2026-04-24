# E2E harness

End-to-end tests that publish the `piot-fixture-zzz-*` canary family to **real registries** (crates.io, PyPI, npm). Not run on every push — `workflow_dispatch` only via `.github/workflows/e2e.yml`.

## What this covers

The unit + integration suites verify every code path in the SDK against mocks. This harness is the last-mile check that the full pipeline works against the live registries: OIDC, provenance, tag creation, etc.

## Canary package family

All canary fixture packages are prefixed with `piot-fixture-zzz-*` so they sink in registry search results and nobody mistakes them for real packages. The `zzz` is intentional — it keeps the fixture at the bottom of alphabetical listings.

| Registry   | Package name                                       |
|------------|----------------------------------------------------|
| crates.io  | `piot-fixture-zzz-rust`                            |
| PyPI       | `piot-fixture-zzz-python`                          |
| npm (main) | `piot-fixture-zzz-cli`                             |
| npm (plat) | `piot-fixture-zzz-cli-{target}` (one per platform) |

## Required secrets (in the `e2e` GitHub Actions environment)

| Secret                 | Required | Notes                                                         |
|------------------------|----------|---------------------------------------------------------------|
| `NPM_TOKEN`            | Yes      | Already a repo secret. Write access to `piot-fixture-zzz-cli`. |
| `PYPI_API_TOKEN`       | Yes      | Scoped to `piot-fixture-zzz-python`.                          |
| `CARGO_REGISTRY_TOKEN` | Yes      | Scoped to `piot-fixture-zzz-rust`.                            |

OIDC is the preferred auth path in production; the canary fixtures can use tokens if the OIDC trusted-publisher setup hasn't been wired up for them yet.

## Running locally

```bash
# Dry-run (no actual publish; default)
pnpm run test:e2e

# Actually publish to real registries (opt-in; requires all tokens above)
PIOT_E2E_PUBLISH=1 pnpm run test:e2e
```

## Version computation

Each canary run uses a unix-seconds version shard appended to `0.0.` (e.g. `0.0.1717534920`). That guarantees:

- Monotonically increasing (seconds since epoch).
- Never collides with a human-authored version (the `patch` field is a 10-digit number).
- crates.io's "immutable publish" semantics don't block us.

If a run publishes 3 packages at the same second, they all share the same version. That's fine — they're independent, and the tag name disambiguates.

## Cleanup

Run `pnpm run test:e2e:cleanup` (to be added in a follow-up PR) to yank/deprecate canary versions older than 30 days. crates.io's `cargo yank`, npm's `npm deprecate`, and PyPI's web UI each handle the registry-specific flow.

## Fixtures

`test/fixtures/e2e-canary/` contains the minimal source tree for the canary packages. It's deliberately tiny — just enough to build a valid artifact for each registry.

## Architecture

`test/e2e/harness.ts` is a thin wrapper around `execFileSync` that:

1. Computes the canary version.
2. Writes `putitoutthere.toml` + per-language manifests with that version.
3. Runs `node dist/cli-bin.js plan` and asserts the matrix has the expected rows.
4. Optionally runs `node dist/cli-bin.js publish`.
5. Asserts `{name}-v{version}` tags exist in the local repo afterward.

Each `*.e2e.test.ts` file exercises one slice of the pipeline (plan-only, dry-run publish, real publish). Real-publish tests gate on `PIOT_E2E_PUBLISH=1`.
