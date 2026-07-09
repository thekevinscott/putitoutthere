import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveNpmTarballUrl } from './resolve-url.js';

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const execMock = vi.mocked(execFileSync);
const out: string[] = [];

beforeEach(() => {
  execMock.mockReset();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveNpmTarballUrl', () => {
  it('returns the trimmed URL on the first successful view, no sleep', async () => {
    execMock.mockReturnValue('https://reg/pkg.tgz\n');
    const url = await resolveNpmTarballUrl('pkg', '1.0.0', { sleeps: [1] });
    expect(url).toBe('https://reg/pkg.tgz');
    // Flags appended after positionals so the spec stays out of the flag slot.
    expect(execMock).toHaveBeenCalledWith(
      'npm',
      ['view', 'pkg@1.0.0', 'dist.tarball'],
      expect.anything(),
    );
    expect(out.join('')).toBe('');
  });

  it('passes --registry through when set', async () => {
    execMock.mockReturnValue('https://reg/pkg.tgz\n');
    await resolveNpmTarballUrl('pkg', '1.0.0', { registry: 'http://localhost:4873', sleeps: [] });
    expect(execMock).toHaveBeenCalledWith(
      'npm',
      ['view', 'pkg@1.0.0', 'dist.tarball', '--registry', 'http://localhost:4873'],
      expect.anything(),
    );
  });

  it('retries through empty packument reads, then gives up with null', async () => {
    execMock.mockReturnValue('');
    vi.useFakeTimers();
    try {
      const p = resolveNpmTarballUrl('pkg', '1.0.0', { sleeps: [1] });
      await vi.runAllTimersAsync();
      expect(await p).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    expect(out.join('')).toContain('packument lag: npm view returned empty (attempt 1/2); retrying in 1s');
  });

  it('treats a non-zero npm view exit as empty', async () => {
    execMock.mockImplementation(() => {
      throw Object.assign(new Error('E404'), { status: 1 });
    });
    expect(await resolveNpmTarballUrl('pkg', '1.0.0', { sleeps: [] })).toBeNull();
  });
});
