import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ctx } from '../types.js';
import { execCapture } from '../utils/exec-capture.js';
import { isPlatformPublished } from './is-platform-published.js';

vi.mock('../utils/exec-capture.js');

const execMock = vi.mocked(execCapture);

const ctx: Ctx = {
  cwd: '/repo',
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  env: {},
  artifacts: { get: () => '', has: () => false },
};

beforeEach(() => {
  execMock.mockReset();
});

describe('isPlatformPublished', () => {
  it('returns true when `npm view` resolves, probing the exact coordinate from ctx.cwd', async () => {
    execMock.mockResolvedValue({ stdout: '0.2.0\n', stderr: '' });
    await expect(isPlatformPublished('demo-cli-linux-x64-gnu', '0.2.0', ctx)).resolves.toBe(true);
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock).toHaveBeenCalledWith(
      'npm',
      ['view', 'demo-cli-linux-x64-gnu@0.2.0', 'version'],
      { cwd: '/repo' },
    );
  });

  it('returns false when `npm view` rejects', async () => {
    execMock.mockRejectedValue(new Error('E404'));
    await expect(isPlatformPublished('demo-cli-linux-x64-gnu', '0.2.0', ctx)).resolves.toBe(false);
  });
});
