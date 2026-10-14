import { beforeEach, describe, expect, it, vi } from 'vitest';

import { collectChanges } from './collect-changes.js';
import type { Package } from './config.js';
import { diffNames, lastTag } from './git.js';

vi.mock('./git.js');

function pkg(name: string): Package {
  return { name, tag_format: '{name}-v{version}' } as Package;
}

function tags(map: Record<string, string>): void {
  vi.mocked(lastTag).mockImplementation((name: string) => {
    const tag = map[name];
    return Promise.resolve(tag === undefined ? null : { tag, version: { major: 1, minor: 0, patch: 0 } });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(diffNames).mockImplementation((from: string) => Promise.resolve([`${from}.txt`]));
});

describe('collectChanges', () => {
  it('marks untagged packages as first releases without diffing', async () => {
    tags({});
    const out = await collectChanges([pkg('a')], 'repo');
    expect([...out.firstRelease]).toEqual(['a']);
    expect(out.changesByPackage.size).toBe(0);
    expect(diffNames).not.toHaveBeenCalled();
  });

  it('diffs each tagged package from its last tag to HEAD', async () => {
    tags({ a: 'a-v1.0.0', b: 'b-v1.0.0' });
    const out = await collectChanges([pkg('a'), pkg('b')], 'repo');
    expect(lastTag).toHaveBeenCalledWith('a', '{name}-v{version}', { cwd: 'repo' });
    expect(diffNames).toHaveBeenCalledWith('a-v1.0.0', 'HEAD', { cwd: 'repo' });
    expect([...out.changesByPackage.get('a')!]).toEqual(['a-v1.0.0.txt']);
    expect([...out.changesByPackage.get('b')!]).toEqual(['b-v1.0.0.txt']);
    expect(out.firstRelease.size).toBe(0);
  });

  it('diffs a shared tag once', async () => {
    tags({ a: 'v1.0.0', b: 'v1.0.0' });
    const out = await collectChanges([pkg('a'), pkg('b')], 'repo');
    expect(diffNames).toHaveBeenCalledTimes(1);
    expect(out.changesByPackage.get('b')).toBe(out.changesByPackage.get('a'));
  });
});
