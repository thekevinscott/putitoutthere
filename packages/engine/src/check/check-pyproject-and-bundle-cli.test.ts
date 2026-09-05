import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckFinding } from '../check.js';
import type { Package } from '../config.js';
import { checkPyprojectAndBundleCli } from './check-pyproject-and-bundle-cli.js';
import { readDeclaredBins } from './read-declared-bins.js';

vi.mock('node:fs/promises');
vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));
vi.mock('./read-declared-bins.js');

const CWD = '/repo';
// Expected paths are built with the same real node:path calls the source
// makes, so the assertions hold across separators and drive letters.
const PYPROJECT = join('/repo/py', 'pyproject.toml');
const CRATE_ABS = resolve(CWD, 'rs');
const CARGO = join(CRATE_ABS, 'Cargo.toml');

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
      { package: 'py', message: `pyproject.toml not found at ${PYPROJECT}` },
    ]);
  });

  it('stops at pyproject presence for non-maturin builds and when bundle_cli is unset', async () => {
    statFrom({ [PYPROJECT]: 'file' });
    const findings: CheckFinding[] = [];
    await checkPyprojectAndBundleCli(pkg({ build: 'hatch' }), CWD, findings);
    await checkPyprojectAndBundleCli(pkg({ bundle_cli: undefined }), CWD, findings);
    expect(findings).toEqual([]);
    expect(readDeclaredBins).not.toHaveBeenCalled();
  });

  it('flags a bundle_cli.crate_path that is missing or not a directory', async () => {
    statFrom({ [PYPROJECT]: 'file', [CRATE_ABS]: 'file' });
    const findings: CheckFinding[] = [];
    await checkPyprojectAndBundleCli(pkg({}), CWD, findings);
    expect(findings).toEqual([
      { package: 'py', message: 'bundle_cli.crate_path "rs" does not exist or is not a directory' },
    ]);
  });

  it('flags a crate dir without a Cargo.toml', async () => {
    statFrom({ [PYPROJECT]: 'file', [CRATE_ABS]: 'dir' });
    const findings: CheckFinding[] = [];
    await checkPyprojectAndBundleCli(pkg({}), CWD, findings);
    expect(findings).toEqual([
      { package: 'py', message: 'bundle_cli.crate_path "rs" has no Cargo.toml' },
    ]);
  });

  it('flags a bundle_cli.bin absent from the declared bins, listing what was found', async () => {
    statFrom({ [PYPROJECT]: 'file', [CRATE_ABS]: 'dir', [CARGO]: 'file' });
    vi.mocked(readDeclaredBins).mockResolvedValue(['other', 'second']);
    const findings: CheckFinding[] = [];
    await checkPyprojectAndBundleCli(pkg({}), CWD, findings);
    expect(readDeclaredBins).toHaveBeenCalledWith(CARGO);
    expect(findings).toEqual([
      {
        package: 'py',
        message: `bundle_cli.bin "piot" is not declared as a [[bin]] in ${CARGO}. Declared bins: other, second.`,
      },
    ]);
  });

  it('words an empty declared-bin list as (none)', async () => {
    statFrom({ [PYPROJECT]: 'file', [CRATE_ABS]: 'dir', [CARGO]: 'file' });
    vi.mocked(readDeclaredBins).mockResolvedValue([]);
    const findings: CheckFinding[] = [];
    await checkPyprojectAndBundleCli(pkg({}), CWD, findings);
    expect(findings).toEqual([
      {
        package: 'py',
        message: `bundle_cli.bin "piot" is not declared as a [[bin]] in ${CARGO}. Declared bins: (none).`,
      },
    ]);
  });

  it('accepts a declared bundle_cli.bin', async () => {
    statFrom({ [PYPROJECT]: 'file', [CRATE_ABS]: 'dir', [CARGO]: 'file' });
    vi.mocked(readDeclaredBins).mockResolvedValue(['piot']);
    const findings: CheckFinding[] = [];
    await checkPyprojectAndBundleCli(pkg({}), CWD, findings);
    expect(findings).toEqual([]);
  });
});
