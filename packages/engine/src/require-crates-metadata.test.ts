import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkCratesMetadata } from './check-crates-metadata.js';
import type { Package } from './config.js';
import { requireCratesMetadata } from './require-crates-metadata.js';

vi.mock('./check-crates-metadata.js');

const checkMock = vi.mocked(checkCratesMetadata);
const packages = [{ name: 'core', kind: 'crates' }] as unknown as readonly Package[];

async function thrownMessage(): Promise<string> {
  try {
    await requireCratesMetadata(packages);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected requireCratesMetadata to throw');
}

beforeEach(() => {
  checkMock.mockReset();
});

describe('requireCratesMetadata', () => {
  it('returns silently when the check finds nothing', async () => {
    checkMock.mockResolvedValue([]);
    await expect(requireCratesMetadata(packages)).resolves.toBeUndefined();
    expect(checkMock).toHaveBeenCalledWith(packages);
  });

  it('throws one error listing every failing package and its missing fields', async () => {
    checkMock.mockResolvedValue([
      { package: 'a', cargoTomlPath: 'a/Cargo.toml', missing: ['description'] },
      { package: 'b', cargoTomlPath: 'b/Cargo.toml', missing: ['description', 'license'] },
    ]);
    const lines = (await thrownMessage()).split('\n');
    expect(lines.slice(0, 5)).toEqual([
      '[PIOT_CRATES_MISSING_METADATA] cargo publish requires the following Cargo.toml [package] fields: description, and license (or license-file).',
      '',
      'Failing packages:',
      '  - a: a/Cargo.toml (missing: description)',
      '  - b: b/Cargo.toml (missing: description, license)',
    ]);
  });

  it('ends with the example fix and the cargo manifest reference', async () => {
    checkMock.mockResolvedValue([
      { package: 'a', cargoTomlPath: 'a/Cargo.toml', missing: ['license'] },
    ]);
    const lines = (await thrownMessage()).split('\n');
    expect(lines.slice(4)).toEqual([
      '',
      'Why: crates.io rejects publish with `400 Bad Request: missing or empty',
      'metadata fields: ...` after cargo publish has compiled the crate and every',
      'transitive dep — wasting the full publish job on a precondition checkable',
      'in milliseconds.',
      '',
      'Fix: add the missing fields to each Cargo.toml. Example:',
      '',
      '  [package]',
      '  description = "One-line summary of what the crate does."',
      '  license = "MIT OR Apache-2.0"',
      '',
      'See https://doc.rust-lang.org/cargo/reference/manifest.html#package-metadata.',
    ]);
  });
});
