import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Minimal, gate-compatible config for the testing-conventions unit-coverage
// gate (#476). The gate runs vitest rooted at the scan path
// (packages/engine/src) and supplies its own test-discovery include and 100%
// thresholds. So this file must NOT hardcode `include` / `thresholds` /
// `coverage.include` — those are package-root-relative and would resolve wrong
// under the gate's root (finding zero tests → 0% → fail). It names only the
// provider, the reporters the gate reads, and the env-isolation setup file —
// the last via an ABSOLUTE path so it resolves regardless of the vitest root.
// The engine's own runs pass the test dirs positionally (see test:unit /
// test:unit:coverage in package.json). Mirrors packages/ci's minimal config.
//
// `clearMocks` (vitest 4): vi.restoreAllMocks() no longer resets automocks, so
// clearMocks runs vi.clearAllMocks() before each test to clear vi.mock()'d call
// history between tests regardless of how the mock was created.
export default defineConfig({
  test: {
    setupFiles: [fileURLToPath(new URL('./tests/setup.ts', import.meta.url))],
    testTimeout: 10_000,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
    },
  },
});
