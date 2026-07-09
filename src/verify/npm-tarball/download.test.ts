import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadNpmTarball } from './download.js';

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const execMock = vi.mocked(execFileSync);

beforeEach(() => {
  execMock.mockReset();
  execMock.mockReturnValue('');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadNpmTarball', () => {
  it('curls the tarball, extracts it, and returns the package dir', () => {
    const { root, packageDir } = downloadNpmTarball('https://reg/pkg.tgz', 5);
    try {
      expect(packageDir).toBe(`${root}/extracted/package`);

      const curl = execMock.mock.calls.find((c) => c[0] === 'curl')!;
      expect(curl[1]).toEqual([
        '-fsSL', '--retry', '5', '--retry-all-errors', '--retry-delay', '5',
        '-o', `${root}/pkg.tgz`, 'https://reg/pkg.tgz',
      ]);

      const tar = execMock.mock.calls.find((c) => c[0] === 'tar')!;
      expect(tar[1]).toEqual(['-xzf', `${root}/pkg.tgz`, '-C', `${root}/extracted`]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('threads the retry-delay through to curl', () => {
    const { root } = downloadNpmTarball('https://reg/t.tgz', 2);
    try {
      const curl = execMock.mock.calls.find((c) => c[0] === 'curl')!;
      expect(curl[1]).toContain('2');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
