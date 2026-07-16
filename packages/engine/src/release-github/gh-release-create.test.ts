/**
 * `ghReleaseCreate` — `gh release create … --generate-notes` (#444).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ghReleaseCreate } from './gh-release-create.js';
import { execInherit } from '../utils/exec-inherit.js';
import { ExecError } from '../utils/exec-error.js';

vi.mock('../utils/exec-error.js', async () => await vi.importActual<typeof import('../utils/exec-error.js')>('../utils/exec-error.js'));

// Mock the process seam, not node:child_process (#469 seam-mock recipe).
vi.mock('../utils/exec-inherit.js');

const execMock = vi.mocked(execInherit);

beforeEach(() => {
  execMock.mockReset();
});

describe('ghReleaseCreate', () => {
  it('runs gh release create with title + generate-notes, inheriting stdio', async () => {
    execMock.mockResolvedValue(undefined);
    await ghReleaseCreate('pkg-v1.0.0', { cwd: '/repo' });
    expect(execMock).toHaveBeenCalledWith(
      'gh',
      ['release', 'create', 'pkg-v1.0.0', '--title', 'pkg-v1.0.0', '--generate-notes'],
      { cwd: '/repo' },
    );
  });

  it('propagates a non-zero exit (matches the bash set -e)', async () => {
    execMock.mockRejectedValue(new ExecError('gh: release create failed', '', '', 1));
    await expect(ghReleaseCreate('pkg-v1.0.0', { cwd: '/repo' })).rejects.toThrow(
      /release create failed/,
    );
  });
});
