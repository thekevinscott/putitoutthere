import { beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture } from '../utils/exec-capture.js';
import { pingOnce } from './ping-once.js';

vi.mock('../utils/exec-capture.js');

const exec = vi.mocked(execCapture);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('pingOnce', () => {
  it('curls the Verdaccio ping endpoint with fail-fast flags and reports up on success', async () => {
    exec.mockResolvedValue({ stdout: '', stderr: '' });
    await expect(pingOnce()).resolves.toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('curl', ['-fsS', 'http://localhost:4873/-/ping']);
  });

  it('reports down instead of throwing when the curl fails', async () => {
    exec.mockRejectedValue(new Error('connection refused'));
    await expect(pingOnce()).resolves.toBe(false);
  });
});
