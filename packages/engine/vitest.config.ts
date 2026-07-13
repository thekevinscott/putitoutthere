import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'test/fixtures/**/*.test.ts',
      'test/workflows/**/*.test.ts',
    ],
    setupFiles: ['./test/setup.ts'],
    environment: 'node',
    // Vitest 4: vi.restoreAllMocks() no longer resets automocks (only
    // vi.spyOn spies), so per-file afterEach(() => vi.restoreAllMocks())
    // no longer clears vi.mock()'d module call/result history between
    // tests. clearMocks runs vi.clearAllMocks() before each test, which
    // still clears that history regardless of how the mock was created.
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      thresholds: {
        lines: 95,
        statements: 95,
        // Removing `src/init.ts` (which had ~100% branch coverage on file-
        // write logic) shifted the weighted branch average down to ~94.9%.
        // The remaining src/ has harder-to-cover defensive branches in
        // handlers and auth paths; pinning at 93 keeps a small buffer
        // without chasing token-bucket branches in `auth.ts` / `cli.ts`.
        // The patch-coverage gate (.github/workflows/patch-coverage.yml)
        // is the strict 100%-on-new-lines enforcement; the aggregate
        // threshold here is the floor for grandfathered defensive code.
        //
        // @vitest/coverage-v8 2 -> 4: the v4 provider classifies branches
        // by AST node (`if` / `cond-expr` / `binary-expr`) instead of
        // collapsing them into one generic `branch` entry, so it now
        // counts short-circuit (`&&`/`??`) and ternary operands as
        // separate branches the v2 provider never tracked. No src/ line
        // changed; measured branch coverage dropped from ~94.9% to
        // ~91.7% purely from the more precise count. Re-floored at 91
        // (small buffer under the new measured baseline) rather than
        // chasing coverage on newly-visible operands in defensive code.
        branches: 91,
        functions: 95,
      },
    },
  },
});
