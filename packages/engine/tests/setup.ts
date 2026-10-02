/**
 * Vitest global setup. Wires a `beforeEach` hook that isolates the
 * GitHub-Actions-runner env vars the engine reads from `process.env`, so
 * unit-test coverage is deterministic regardless of the ambient environment.
 *
 * Why: several `src/` code paths branch on GitHub-injected env vars —
 * `requireRepoUrlMatch` / `requireRepoPublic` read `GITHUB_REPOSITORY` /
 * `GITHUB_TOKEN`; `emitGhaAnnotation` reads `GITHUB_ACTIONS`; the job-summary
 * writer reads `GITHUB_STEP_SUMMARY`; the CLI's output plumbing reads
 * `GITHUB_OUTPUT`. On a developer machine these are unset; inside GitHub
 * Actions they are all set on every job. If a test relies on the ambient
 * default (e.g. asserting the `GITHUB_ACTIONS !== 'true'` early-return arm),
 * it exercises a *different* branch under CI than locally — which makes
 * coverage of the opposite arm flake between environments. Deleting them here
 * pins the ambient default to "unset"; a test that wants the "set" arm
 * assigns the var explicitly inside its own body.
 *
 * Tests that specifically exercise the set/wired-up path assign the env vars
 * explicitly (after this hook runs); the new preflight unit tests pass
 * `githubRepository` as an option directly and don't depend on `process.env`.
 *
 * SCOPE — this hook does NOT run everywhere. It reaches only the runs that
 * load `vitest.config.ts`: the engine's own `test:unit` /
 * `test:unit:coverage` / `test:integration`. The testing-conventions coverage
 * gate runs vitest rooted at `packages/engine/src`, and since vitest 5 dropped
 * vitest 4's upward config-file search, that run loads no config and so never
 * loads this file. Any test whose assertion depends on one of these vars being
 * unset must stub it itself (`vi.stubEnv(name, undefined)`) — relying on this
 * hook alone passes locally and fails under the gate in CI, which is exactly
 * how the vitest 5 upgrade surfaced two latent failures in src/check.test.ts.
 */

import { beforeEach } from 'vitest';

beforeEach(() => {
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_ACTIONS;
  delete process.env.GITHUB_OUTPUT;
  delete process.env.GITHUB_STEP_SUMMARY;
  delete process.env.CI;
});
