/**
 * Vitest config for the e2e tier: these shell out to the built CLI
 * (`dist/cli-bin.js`) or the ncc-bundled action (`dist-action/index.js`,
 * #595) and hit the real registries. Separate from the unit and integration
 * configs because it depends on a build and on network. Issue #403.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
    // Real network: a handful of registry GETs per test.
    testTimeout: 60_000,
  },
});
