/**
 * Vitest config for E2E tests. Runs slower (builds the CLI + hits real
 * registries when opted-in) and is gated behind `workflow_dispatch` in
 * CI.
 *
 * Issue #28.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
