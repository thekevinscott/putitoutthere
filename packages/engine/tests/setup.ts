/**
 * Vitest global setup. Wires `beforeEach` hooks that isolate the
 * process-env vars the engine reads from the GitHub Actions context.
 *
 * Why: `requireRepoUrlMatch` and `requireRepoPublic` (in
 * `src/preflight.ts`, wired into `publish.ts` and `check.ts`) read
 * `GITHUB_REPOSITORY` and `GITHUB_TOKEN` directly from `process.env`
 * so they fire automatically under GHA without per-test wiring. CI
 * runs always have these set; without isolation, every existing
 * publish / check test inherits them and the new visibility check
 * makes a real GitHub API call (the URL-match check fires only on
 * fixtures that look like github.com URLs, but the visibility check
 * fires on any non-empty `GITHUB_REPOSITORY`).
 *
 * Tests that specifically want to exercise the new wire-up assign
 * the env vars explicitly inside their own `beforeEach` after this
 * file's hook has run. The new preflight unit tests in
 * `preflight.test.ts` pass `githubRepository` as an option directly
 * and don't depend on `process.env` at all.
 */

import { beforeEach } from 'vitest';

beforeEach(() => {
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_TOKEN;
});
