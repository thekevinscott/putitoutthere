import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from './config.js';
import { lastTag } from './git.js';
import { manualVersion } from './manual-version.js';

vi.mock('./git.js');

const pkg = { name: 'a', tag_format: '{name}-v{version}', first_version: '0.1.0' } as Package;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lastTag).mockResolvedValue({ tag: 'a-v1.2.3', version: { major: 1, minor: 2, patch: 3 } });
});

describe('manualVersion', () => {
  it('uses an explicit version verbatim without reading tags', async () => {
    expect(await manualVersion(pkg, { name: 'a', version: '1.0.0' }, 'repo')).toBe('1.0.0');
    expect(lastTag).not.toHaveBeenCalled();
  });

  it('bumps the last tag by the entry bump', async () => {
    expect(await manualVersion(pkg, { name: 'a', bump: 'minor' }, 'repo')).toBe('1.3.0');
    expect(lastTag).toHaveBeenCalledWith('a', '{name}-v{version}', { cwd: 'repo' });
  });

  it('returns first_version when the package has no tag', async () => {
    vi.mocked(lastTag).mockResolvedValue(null);
    expect(await manualVersion(pkg, { name: 'a', bump: 'major' }, 'repo')).toBe('0.1.0');
  });
});
