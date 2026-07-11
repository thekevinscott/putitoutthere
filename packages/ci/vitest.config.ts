import { defineConfig } from 'vitest/config';

// Minimal config for the testing-conventions coverage gate (#475): it
// supplies the test-discovery include and the 100% thresholds itself,
// root-relative to the scan path — so this file only names the provider and
// the reporters the gate reads. Matches the tool's documented example.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
});
