/**
 * Vitest global setup: a `beforeEach` unsetting the GitHub-Actions env vars the
 * engine reads. SCOPE — only runs that load `vitest.config.ts` get it; vitest 5
 * dropped vitest 4's upward config search, so the coverage gate (rooted at
 * `packages/engine/src`) does not — stub with `vi.stubEnv(name, undefined)`.
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
