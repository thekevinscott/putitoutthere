/**
 * `ghReleaseCreate` — `gh release create … --generate-notes` (#444).
 */

import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ghReleaseCreate } from './gh-release-create.js';

// Bare automock (no factory): vitest generates the double from the real
// module, so it can't drift from the source — satisfying the unit-suite
// isolation lint without a hand-written (untyped) factory. Every call is
// driven per-test via `execMock`.
vi.mock('node:child_process');

const execMock = vi.mocked(execFileSync);

beforeEach(() => {
  execMock.mockReset();
});

describe('ghReleaseCreate', () => {
  it('runs gh release create with title + generate-notes, inheriting stdio', () => {
    execMock.mockReturnValue(Buffer.from(''));
    ghReleaseCreate('pkg-v1.0.0', { cwd: '/repo' });
    expect(execMock).toHaveBeenCalledWith(
      'gh',
      ['release', 'create', 'pkg-v1.0.0', '--title', 'pkg-v1.0.0', '--generate-notes'],
      { cwd: '/repo', stdio: 'inherit' },
    );
  });

  it('propagates a non-zero exit (matches the bash set -e)', () => {
    execMock.mockImplementation(() => {
      throw new Error('gh: release create failed');
    });
    expect(() => ghReleaseCreate('pkg-v1.0.0', { cwd: '/repo' })).toThrow(/release create failed/);
  });
});
