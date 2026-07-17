import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveNpmTarballUrl } from './resolve-url.js';
import { execCapture } from '../../utils/exec-capture.js';
import { ExecError } from '../../utils/exec-error.js';

vi.mock('../../utils/exec-error.js', async () => await vi.importActual<typeof import('../../utils/exec-error.js')>('../../utils/exec-error.js'));

// Bare automock (no factory): the double is derived from the real seam
// module, so it can't drift and needs no hand-written factory. Real `npm view`
// behaviour is covered by the integration and e2e tiers.
vi.mock('../../utils/exec-capture.js');

const execMock = vi.mocked(execCapture);
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
    execMock.mockResolvedValue({ stdout: 'https://reg/pkg.tgz\n', stderr: '' });
    const url = await resolveNpmTarballUrl('pkg', '1.0.0', { sleeps: [1] });
    expect(url).toBe('https://reg/pkg.tgz');
    // Flags appended after positionals so the spec stays out of the flag slot.
    expect(execMock).toHaveBeenCalledWith(
      'npm',
      ['view', 'pkg@1.0.0', 'dist.tarball'],
    );
    expect(out.join('')).toBe('');
  });

  it('passes --registry through when set', async () => {
    execMock.mockResolvedValue({ stdout: 'https://reg/pkg.tgz\n', stderr: '' });
    await resolveNpmTarballUrl('pkg', '1.0.0', { registry: 'http://localhost:4873', sleeps: [] });
    expect(execMock).toHaveBeenCalledWith(
      'npm',
      ['view', 'pkg@1.0.0', 'dist.tarball', '--registry', 'http://localhost:4873'],
    );
  });

  it('retries through empty packument reads, then gives up with null', async () => {
    execMock.mockResolvedValue({ stdout: '', stderr: '' });
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
    execMock.mockRejectedValue(new ExecError('E404', '', '', 1));
    expect(await resolveNpmTarballUrl('pkg', '1.0.0', { sleeps: [] })).toBeNull();
  });
});
