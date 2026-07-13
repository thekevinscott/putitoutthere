import { defineConfig } from 'vitest/config';

// Minimal config for the testing-conventions coverage gate (#475): it
// supplies the test-discovery include and the 100% thresholds itself,
// root-relative to the scan path — so this file only names the provider and
// the reporters the gate reads. Matches the tool's documented example.
export default defineConfig({
  test: {
    // Vitest 4: vi.restoreAllMocks() no longer resets automocks (only
    // vi.spyOn spies), so per-file afterEach(() => vi.restoreAllMocks())
    // no longer clears vi.mock()'d module call/result history between
    // tests. clearMocks runs vi.clearAllMocks() before each test, which
    // still clears that history regardless of how the mock was created.
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
});
