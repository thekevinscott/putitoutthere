import { stat } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from '../config.js';
import { checkPyprojectAndBundleCli } from './check-pyproject-and-bundle-cli.js';
import type { CheckFinding } from './check-types.js';
import { readDeclaredBins } from './read-declared-bins.js';

vi.mock('node:fs/promises');
vi.mock('./read-declared-bins.js');

const CWD = '/repo';

/** stat mock backed by a path → kind map; anything absent rejects. */
function statFrom(tree: Record<string, 'dir' | 'file'>): void {
  vi.mocked(stat).mockImplementation((path) => {
    const kind = tree[path as string];
    if (kind === undefined) {
      return Promise.reject(new Error('ENOENT'));
    }
    return Promise.resolve({ isDirectory: () => kind === 'dir' } as Awaited<ReturnType<typeof stat>>);
  });
}

function pkg(overrides: Record<string, unknown>): readonly Package[] {
  return [
    {
      name: 'py',
      kind: 'pypi',
      path: '/repo/py',
      build: 'maturin',
      bundle_cli: { crate_path: 'rs', bin: 'piot' },
      ...overrides,
    },
  ] as unknown as readonly Package[];
}

describe('checkPyprojectAndBundleCli', () => {
  beforeEach(() => {
    statFrom({});
  });

  it('skips non-pypi packages', async () => {
    const findings: CheckFinding[] = [];
    await checkPyprojectAndBundleCli(pkg({ kind: 'npm' }), CWD, findings);
    expect(findings).toEqual([]);
  });

  it('flags a missing pyproject.toml', async () => {
    const findings: CheckFinding[] = [];
    await checkPyprojectAndBundleCli(pkg({}), CWD, findings);
    expect(findings).toEqual([
      { package: 'py', message: 'pyproject.toml not found at /repo/py/pyproject.toml' },
    ]);
  });

  it('stops at pyproject presence for non-maturin builds and when bundle_cli is unset', async () => {
    statFrom({ '/repo/py/pyproject.toml': 'file' });
    const findings: CheckFinding[] = [];
    await checkPyprojectAndBundleCli(pkg({ build: 'hatch' }), CWD, findings);
    await checkPyprojectAndBundleCli(pkg({ bundle_cli: undefined }), CWD, findings);
    expect(findings).toEqual([]);
    expect(readDeclaredBins).not.toHaveBeenCalled();
  });

  it('flags a bundle_cli.crate_path that is missing or not a directory', async () => {
    statFrom({ '/repo/py/pyproject.toml': 'file', '/repo/rs': 'file' });
    const findings: CheckFinding[] = [];
    await checkPyprojectAndBundleCli(pkg({}), CWD, findings);
    expect(findings).toEqual([
      { package: 'py', message: 'bundle_cli.crate_path "rs" does not exist or is not a directory' },
    ]);
  });

  it('flags a crate dir without a Cargo.toml', async () => {
    statFrom({ '/repo/py/pyproject.toml': 'file', '/repo/rs': 'dir' });
    const findings: CheckFinding[] = [];
    await checkPyprojectAndBundleCli(pkg({}), CWD, findings);
    expect(findings).toEqual([
      { package: 'py', message: 'bundle_cli.crate_path "rs" has no Cargo.toml' },
    ]);
  });

  it('flags a bundle_cli.bin absent from the declared bins, listing what was found', async () => {
    statFrom({
      '/repo/py/pyproject.toml': 'file',
      '/repo/rs': 'dir',
      '/repo/rs/Cargo.toml': 'file',
    });
    vi.mocked(readDeclaredBins).mockResolvedValue(['other']);
    const findings: CheckFinding[] = [];
    await checkPyprojectAndBundleCli(pkg({}), CWD, findings);
    expect(readDeclaredBins).toHaveBeenCalledWith('/repo/rs/Cargo.toml');
    expect(findings).toEqual([
      {
        package: 'py',
        message:
          'bundle_cli.bin "piot" is not declared as a [[bin]] in /repo/rs/Cargo.toml. Declared bins: other.',
      },
    ]);
  });

  it('words an empty declared-bin list as (none)', async () => {
    statFrom({
      '/repo/py/pyproject.toml': 'file',
      '/repo/rs': 'dir',
      '/repo/rs/Cargo.toml': 'file',
    });
    vi.mocked(readDeclaredBins).mockResolvedValue([]);
    const findings: CheckFinding[] = [];
    await checkPyprojectAndBundleCli(pkg({}), CWD, findings);
    expect(findings).toEqual([
      {
        package: 'py',
        message:
          'bundle_cli.bin "piot" is not declared as a [[bin]] in /repo/rs/Cargo.toml. Declared bins: (none).',
      },
    ]);
  });

  it('accepts a declared bundle_cli.bin', async () => {
    statFrom({
      '/repo/py/pyproject.toml': 'file',
      '/repo/rs': 'dir',
      '/repo/rs/Cargo.toml': 'file',
    });
    vi.mocked(readDeclaredBins).mockResolvedValue(['piot']);
    const findings: CheckFinding[] = [];
    await checkPyprojectAndBundleCli(pkg({}), CWD, findings);
    expect(findings).toEqual([]);
  });
});
