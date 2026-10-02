import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Minimal, gate-compatible config for the testing-conventions unit-coverage
// gate (#476), which runs vitest rooted at packages/engine/src with its own
// include and thresholds. Do NOT hardcode `include` / `thresholds` /
// `coverage.include`: package-root-relative, they resolve wrong under that root
// (zero tests → 0% → fail). `setupFiles` reaches the gate's run only via vitest
// 4's upward config search from `--root`; vitest 5 dropped that search and we
// are pinned to 4 only until the mutation gate can run on 5 (#715), so a test
// needing an env var unset stubs it itself rather than relying on this.
// `clearMocks` is load-bearing: vi.restoreAllMocks() does not reset automocks,
// so without it vi.mock() call history leaks between tests.
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
