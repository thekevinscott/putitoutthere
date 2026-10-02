/**
 * Vitest config for packages/ci integration tests. Kept separate from the unit
 * config (`vitest.config.ts`) so the coverage gate — which roots at `src` and
 * injects its own include — never sees these cross-module, boundary-mocked
 * files. Invoked via `pnpm run test:integration` (epic #442, #452).
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
    // See vitest.config.ts: Vitest 4's vi.restoreAllMocks() no longer clears
    // automock call/result history; clearMocks restores that between tests.
    clearMocks: true,
  },
});
