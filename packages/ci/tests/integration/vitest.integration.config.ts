/**
 * Vitest config for packages/ci integration tests. Kept separate from the
 * unit config (`vitest.config.ts`) so the coverage gate — which roots at
 * `src` and injects its own include — never sees these cross-module,
 * boundary-mocked files. Invoked via `pnpm run test:integration`.
 *
 * Each gate's integration test drives the real `piot-ci` dispatch in-process
 * (`run()` → `run<Gate>` → `decide<Gate>`) with only the OS boundary (git
 * subprocess / fs reads) mocked — the mocked-integration tier the repo wants
 * for every CLI feature (epic #442, #452). This is distinct from the
 * colocated `run.test.ts` wiring tests under `src`, which additionally mock
 * `decide` to isolate the composition root.
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
