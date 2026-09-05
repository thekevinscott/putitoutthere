import { describe, expect, it, vi } from 'vitest';

import { execCapture } from '../utils/exec-capture.js';
import { listTrackedFiles } from './list-tracked-files.js';

vi.mock('../utils/exec-capture.js');

describe('listTrackedFiles', () => {
  it('splits git ls-files output into lines, dropping the trailing blank', async () => {
    vi.mocked(execCapture).mockResolvedValue({ stdout: 'a.txt\nrs/lib.rs\n', stderr: '' });
    expect(await listTrackedFiles('/repo')).toEqual(['a.txt', 'rs/lib.rs']);
    expect(execCapture).toHaveBeenCalledWith('git', ['ls-files'], { cwd: '/repo' });
  });

  it('returns an empty list for empty output', async () => {
    vi.mocked(execCapture).mockResolvedValue({ stdout: '', stderr: '' });
    expect(await listTrackedFiles('/repo')).toEqual([]);
  });

  it('returns null when git fails (e.g. not a repo)', async () => {
    vi.mocked(execCapture).mockRejectedValue(new Error('not a git repository'));
    expect(await listTrackedFiles('/repo')).toBeNull();
  });
});
