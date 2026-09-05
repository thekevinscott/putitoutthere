import { describe, expect, it, vi } from 'vitest';

import type { Package } from '../config.js';
import { checkGlobsMatchTrackedFiles } from './check-globs-match-tracked-files.js';
import type { CheckFinding } from './check-types.js';
import { listTrackedFiles } from './list-tracked-files.js';

vi.mock('./list-tracked-files.js');

describe('checkGlobsMatchTrackedFiles', () => {
  it('skips entirely when the tracked-file list is unavailable', async () => {
    vi.mocked(listTrackedFiles).mockResolvedValue(null);
    const findings: CheckFinding[] = [];
    await checkGlobsMatchTrackedFiles(
      [{ name: 'py', globs: ['py/**'] }] as unknown as readonly Package[],
      '/repo',
      findings,
    );
    expect(listTrackedFiles).toHaveBeenCalledWith('/repo');
    expect(findings).toEqual([]);
  });

  it('flags only the package whose globs match no tracked file', async () => {
    vi.mocked(listTrackedFiles).mockResolvedValue(['rs/src/lib.rs', 'README.md']);
    const findings: CheckFinding[] = [];
    await checkGlobsMatchTrackedFiles(
      [
        { name: 'rs', globs: ['rs/**'] },
        { name: 'py', globs: ['py/**'] },
      ] as unknown as readonly Package[],
      '/repo',
      findings,
    );
    expect(findings).toEqual([
      {
        package: 'py',
        message:
          'globs ["py/**"] matched no tracked files. Empty globs mean the package will never cascade on a real commit.',
      },
    ]);
  });
});
