import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkCargoShape } from './check-cargo-shape.js';
import type { Package } from './config.js';
import { requireCargoShape } from './require-cargo-shape.js';

vi.mock('./check-cargo-shape.js');

const checkMock = vi.mocked(checkCargoShape);
const packages = [{ name: 'a', kind: 'crates' }] as unknown as readonly Package[];

async function thrownMessage(): Promise<string> {
  try {
    await requireCargoShape(packages, { cwd: '/repo' });
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected requireCargoShape to throw');
}

beforeEach(() => {
  checkMock.mockReset();
});

describe('requireCargoShape', () => {
  it('returns silently when the check finds nothing', async () => {
    checkMock.mockResolvedValue([]);
    await expect(requireCargoShape(packages, { cwd: '/repo' })).resolves.toBeUndefined();
    expect(checkMock).toHaveBeenCalledWith(packages, { cwd: '/repo' });
  });

  it('defaults the options to an empty object', async () => {
    checkMock.mockResolvedValue([]);
    await requireCargoShape(packages);
    expect(checkMock).toHaveBeenCalledWith(packages, {});
  });

  it('throws naming every failing package + every error code', async () => {
    checkMock.mockResolvedValue([
      {
        package: 'a',
        cargoTomlPath: 'a/Cargo.toml',
        code: 'PIOT_CRATES_NAME_MISMATCH',
        detail: '[package].name = "wrong-a" but configured name is "a"',
      },
      {
        package: 'b',
        cargoTomlPath: 'b/Cargo.toml',
        code: 'PIOT_CRATES_FEATURE_NOT_DECLARED',
        detail: 'unknown-feature',
      },
    ]);
    expect((await thrownMessage()).split('\n')).toEqual([
      'Pre-flight Cargo.toml shape check failed:',
      '',
      '  [PIOT_CRATES_NAME_MISMATCH] a: a/Cargo.toml',
      '    [package].name = "wrong-a" but configured name is "a"',
      '  [PIOT_CRATES_FEATURE_NOT_DECLARED] b: b/Cargo.toml',
      '    unknown-feature',
      '',
      'Why: these mismatches would otherwise surface mid-`cargo build` or mid-`cargo',
      'publish` after the verification build has compiled the crate and every transitive',
      'dep — wasting the publish job on a precondition checkable in milliseconds.',
      'Fix the Cargo.toml + putitoutthere.toml fields in this list, then re-run.',
    ]);
  });
});
