import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from './config.js';
import { manualVersion } from './manual-version.js';
import { planManual } from './plan-manual.js';
import type { MatrixRow } from './plan.js';
import type { ReleasePackagesEntry } from './release-packages.js';
import { rowsForPackage } from './rows-for-package.js';

vi.mock('./manual-version.js');
vi.mock('./rows-for-package.js');

const pkgs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }] as Package[];

function manual(...names: string[]): Map<string, ReleasePackagesEntry> {
  return new Map(names.map((name) => [name, { name, bump: 'patch' }]));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(manualVersion).mockImplementation((p) => Promise.resolve(`${p.name}-ver`));
  vi.mocked(rowsForPackage).mockImplementation((p, version) =>
    Promise.resolve([{ name: p.name, version } as MatrixRow]),
  );
});

describe('planManual', () => {
  it('throws on a package not declared in config', async () => {
    await expect(planManual(pkgs, manual('a', 'zzz'), 'repo')).rejects.toThrow(
      'release-packages: "zzz" is not declared in putitoutthere.toml',
    );
    expect(rowsForPackage).not.toHaveBeenCalled();
  });

  it('plans only the named packages, in config order', async () => {
    const rows = await planManual(pkgs, manual('c', 'a'), 'repo');
    expect(rows).toEqual([
      { name: 'a', version: 'a-ver' },
      { name: 'c', version: 'c-ver' },
    ]);
    expect(manualVersion).toHaveBeenCalledWith(pkgs[0], { name: 'a', bump: 'patch' }, 'repo');
    expect(rowsForPackage).toHaveBeenCalledWith(pkgs[2], 'c-ver', 'repo');
  });
});
