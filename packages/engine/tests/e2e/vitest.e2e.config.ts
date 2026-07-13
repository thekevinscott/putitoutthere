/**
 * Vitest config for the e2e tier. These tests **shell out to the built
 * CLI** (`dist/cli-bin.js`) and hit the **real** registries — no mocks.
 * `test:e2e` builds `dist/` first. Kept separate from the unit and
 * integration configs because it depends on a build and on network.
 *
 * Issue #403.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    setupFiles: ['./test/setup.ts'],
    environment: 'node',
    // Real network: a handful of registry GETs per test.
    testTimeout: 60_000,
  },
});
