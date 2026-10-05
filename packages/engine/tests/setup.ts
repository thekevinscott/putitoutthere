/**
 * Vitest global setup: a `beforeEach` unsetting the GitHub-Actions env vars the
 * engine reads, so coverage of the "unset" arms cannot flake between a bare
 * machine and CI. SCOPE — only runs that load `vitest.config.ts` get it. vitest
 * 4 searches upward from `--root`, so the coverage gate (rooted at
 * `packages/engine/src`) does; vitest 5 dropped that search and we are pinned
 * to 4 only until the mutation gate can run on 5 (#715) — so a test whose
 * assertion needs one of these unset stubs it itself with
 * `vi.stubEnv(name, undefined)`, which is root-independent.
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
