import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Minimal, gate-compatible config for the testing-conventions unit-coverage
// gate (#476). The gate runs vitest rooted at the scan path
// (packages/engine/src) and supplies its own test-discovery include and 100%
// thresholds. So this file must NOT hardcode `include` / `thresholds` /
// `coverage.include` — those are package-root-relative and would resolve wrong
// under the gate's root (finding zero tests → 0% → fail). It names only the
// provider, the reporters the gate reads, and the env-isolation setup file.
// The engine's own runs pass the test dirs positionally (see test:unit /
// test:unit:coverage in package.json). Mirrors packages/ci's minimal config.
//
// `setupFiles` applies to the engine's OWN runs only, NOT to the gate's run.
// vitest 4 searched upward from `--root` for a config file, so the gate's run
// (rooted at packages/engine/src) picked this file up; vitest 5 removed that
// upward search, so at that root vitest loads no config at all and the setup
// file never runs. The absolute path below is therefore necessary but not
// sufficient — a test that needs a GitHub-runner env var neutralised must stub
// it itself (see the `vi.stubEnv` in src/check.test.ts) rather than rely on
// tests/setup.ts, or it will pass locally and fail under the gate in CI.
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
