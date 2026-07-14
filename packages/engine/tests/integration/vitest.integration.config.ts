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
    include: ['tests/integration/**/*.integration.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
    testTimeout: 10_000,
    // See vitest.config.ts: vi.restoreAllMocks() no longer clears automock
    // call/result history in Vitest 4; clearMocks restores that behavior.
    clearMocks: true,
  },
});
