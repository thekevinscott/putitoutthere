/**
 * `ghReleaseExists` — the `gh release view` idempotency guard (#444).
 */

import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ghReleaseExists } from './gh-release-exists.js';

// Bare automock (no factory): vitest generates the double from the real
// module, so it can't drift from the source — satisfying the unit-suite
// isolation lint without a hand-written (untyped) factory. Every call is
// driven per-test via `execMock`.
vi.mock('node:child_process');

const execMock = vi.mocked(execFileSync);

beforeEach(() => {
  execMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ghReleaseExists', () => {
  it('returns true and runs `gh release view <tag>` with cwd when it exits 0', () => {
    execMock.mockReturnValue(Buffer.from(''));
    expect(ghReleaseExists('pkg-v1.0.0', { cwd: '/repo' })).toBe(true);
    expect(execMock).toHaveBeenCalledWith(
      'gh', ['release', 'view', 'pkg-v1.0.0'], { cwd: '/repo', stdio: 'ignore' },
    );
  });

  it('returns false when `gh release view` exits non-zero (Release absent)', () => {
    execMock.mockImplementation(() => {
      throw new Error('release not found');
    });
    expect(ghReleaseExists('pkg-v1.0.0', { cwd: '/repo' })).toBe(false);
  });
});
