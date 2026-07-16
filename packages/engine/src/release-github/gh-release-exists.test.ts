/**
 * `ghReleaseExists` — the `gh release view` idempotency guard (#444).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ghReleaseExists } from './gh-release-exists.js';
import { execCapture } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';

vi.mock('../utils/exec-error.js', async () => await vi.importActual<typeof import('../utils/exec-error.js')>('../utils/exec-error.js'));

// Mock the process seam, not node:child_process (#469 seam-mock recipe).
vi.mock('../utils/exec-capture.js');

const execMock = vi.mocked(execCapture);

beforeEach(() => {
  execMock.mockReset();
});

describe('ghReleaseExists', () => {
  it('returns true and runs `gh release view <tag>` with cwd when it exits 0', async () => {
    execMock.mockResolvedValue({ stdout: '', stderr: '' });
    expect(await ghReleaseExists('pkg-v1.0.0', { cwd: '/repo' })).toBe(true);
    expect(execMock).toHaveBeenCalledWith(
      'gh', ['release', 'view', 'pkg-v1.0.0'], { cwd: '/repo' },
    );
  });

  it('returns false when `gh release view` exits non-zero (Release absent)', async () => {
    execMock.mockRejectedValue(new ExecError('release not found', '', '', 1));
    expect(await ghReleaseExists('pkg-v1.0.0', { cwd: '/repo' })).toBe(false);
  });
});
