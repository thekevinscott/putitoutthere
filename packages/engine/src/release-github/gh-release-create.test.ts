/**
 * `ghReleaseCreate` — `gh release create … --generate-notes` (#444).
 */

import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ghReleaseCreate } from './gh-release-create.js';

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
