/**
 * `ghReleaseExists` — the `gh release view` idempotency guard (#444).
 */

import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ghReleaseExists } from './gh-release-exists.js';

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

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
