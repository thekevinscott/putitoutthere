/**
 * Vitest config for integration tests. Kept separate from the unit
 * config so coverage gates don't try to apply to mock-heavy files.
 *
 * Invoked via `pnpm run test:integration`.
 *
 * Issue #27.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
