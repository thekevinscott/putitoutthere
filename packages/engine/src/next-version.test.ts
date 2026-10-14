import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from './config.js';
import { lastTag } from './git.js';
import { nextVersion } from './next-version.js';

vi.mock('./git.js');

const pkg = { name: 'a', tag_format: '{name}-v{version}', first_version: '0.1.0' } as Package;
const none = new Set<string>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lastTag).mockResolvedValue({ tag: 'a-v1.2.3', version: { major: 1, minor: 2, patch: 3 } });
});

describe('nextVersion', () => {
  it('returns first_version when the package has no tag', async () => {
    vi.mocked(lastTag).mockResolvedValue(null);
    expect(await nextVersion(pkg, 'major', 'repo', none)).toBe('0.1.0');
  });

  it('looks up the last tag by name and tag_format in cwd', async () => {
    await nextVersion(pkg, undefined, 'repo', none);
    expect(lastTag).toHaveBeenCalledWith('a', '{name}-v{version}', { cwd: 'repo' });
  });

  it('defaults to a patch bump without a trailer', async () => {
    expect(await nextVersion(pkg, undefined, 'repo', none)).toBe('1.2.4');
  });

  it('applies the trailer bump to every package when the trailer lists none', async () => {
    expect(await nextVersion(pkg, 'minor', 'repo', none)).toBe('1.3.0');
  });

  it('applies the trailer bump to a listed package', async () => {
    expect(await nextVersion(pkg, 'major', 'repo', new Set(['a']))).toBe('2.0.0');
  });

  it('patches an unlisted package when the trailer scopes its bump', async () => {
    expect(await nextVersion(pkg, 'major', 'repo', new Set(['b']))).toBe('1.2.4');
  });

  it('patches on a skip bump', async () => {
    expect(await nextVersion(pkg, 'skip', 'repo', none)).toBe('1.2.4');
  });
});
