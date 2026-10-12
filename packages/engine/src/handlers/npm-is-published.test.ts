import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransientError, type Ctx } from '../types.js';
import { execCapture } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';
import { npmIsPublished } from './npm-is-published.js';

vi.mock('../utils/exec-capture.js');
vi.mock('../types.js', async () => await vi.importActual<typeof import('../types.js')>('../types.js'));
vi.mock('../utils/exec-error.js', async () => await vi.importActual<typeof import('../utils/exec-error.js')>('../utils/exec-error.js'));

const execMock = vi.mocked(execCapture);
const ctx = { cwd: '/repo' } as Ctx;
const pkg = { name: 'pkg', path: '/repo/pkg', npm: '@s/pkg' };

function failWith(stderr: string): void {
  execMock.mockRejectedValue(new ExecError('failed', '', stderr, 1));
}

beforeEach(() => {
  execMock.mockReset();
});

describe('npmIsPublished', () => {
  it('runs npm view against the npm name with npm retries off', async () => {
    execMock.mockResolvedValue({ stdout: '1.0.0', stderr: '' });
    await expect(npmIsPublished(pkg, '1.0.0', ctx)).resolves.toBe(true);
    expect(execMock).toHaveBeenCalledWith(
      'npm',
      ['view', '@s/pkg@1.0.0', 'version', '--fetch-retries=0'],
      { cwd: '/repo' },
    );
  });

  it('reads a non-ExecError failure as unpublished', async () => {
    execMock.mockRejectedValue(new Error('boom'));
    await expect(npmIsPublished(pkg, '1.0.0', ctx)).resolves.toBe(false);
  });

  it('reads E404 as unpublished', async () => {
    failWith('npm error code E404\n');
    await expect(npmIsPublished(pkg, '1.0.0', ctx)).resolves.toBe(false);
  });

  it('throws a plain Error when the registry is unreachable', async () => {
    failWith('npm error code ENOTFOUND\n');
    const err = await npmIsPublished(pkg, '1.0.0', ctx).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(TransientError);
    expect((err as Error).message).toBe(
      'npm view @s/pkg@1.0.0 failed: the npm registry could not be reached\nnpm error code ENOTFOUND',
    );
  });

  it('throws a TransientError when the registry falters', async () => {
    failWith('npm error code E503\n');
    const err = await npmIsPublished(pkg, '1.0.0', ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransientError);
    expect((err as Error).message).toBe(
      'npm view @s/pkg@1.0.0 failed: transient registry error\nnpm error code E503',
    );
  });
});
