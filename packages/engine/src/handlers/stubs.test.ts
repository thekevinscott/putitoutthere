/**
 * Tracks which handlers are still scaffold stubs. As #16–#19 land,
 * each handler graduates out of this file into its own test suite
 * (e.g., crates.test.ts). Stubs throw a "not implemented" error
 * pointing at the follow-up issue.
 */

/**
 * Every handler now has its own test file; no stubs remain. This
 * placeholder keeps the file present (referenced in docs) but empty.
 */

import { describe, it } from 'vitest';

describe('handler stubs', () => {
  it('all handlers are implemented', () => {
    // Intentional placeholder.
  });
});
