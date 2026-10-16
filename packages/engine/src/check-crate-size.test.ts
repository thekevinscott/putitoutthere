import { afterEach, describe, expect, it, vi } from 'vitest';

import { packagedCrateBytes } from './packaged-crate-bytes.js';

vi.mock('./packaged-crate-bytes.js');

import { checkCratesPackageSize } from './check-crate-size.js';
import type { Package } from './config.js';

const bytesMock = vi.mocked(packagedCrateBytes);

const MiB = 1024 * 1024;

function makePkg(kind: Package['kind'], name = `${kind}-pkg`): Package {
  return {
    name,
    kind,
    path: 'packages/pkg',
    globs: ['packages/pkg/**'],
    depends_on: [],
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
  } as unknown as Package;
}

afterEach(() => {
  bytesMock.mockReset();
});

describe('checkCratesPackageSize (#362)', () => {
  it("flags a crates package whose .crate exceeds crates.io's 10 MiB limit", async () => {
    bytesMock.mockResolvedValue(Math.round(133.6 * MiB));
    const findings = await checkCratesPackageSize([makePkg('crates', 'rust-lib')]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.package).toBe('rust-lib');
    expect(findings[0]!.message).toMatch(/PIOT_CRATES_PACKAGE_TOO_LARGE/);
    expect(findings[0]!.message).toMatch(/packages\/pkg\/Cargo\.toml/);
    expect(findings[0]!.message).toMatch(/133\.6 MiB/);
    expect(findings[0]!.message).toMatch(/10\.0 MiB \(10485760-byte\)/);
    expect(findings[0]!.message).toMatch(/413 Payload Too Large/);
    expect(bytesMock).toHaveBeenCalledWith('packages/pkg/Cargo.toml');
  });

  it('does not flag a .crate exactly at the limit', async () => {
    bytesMock.mockResolvedValue(10 * MiB);
    expect(await checkCratesPackageSize([makePkg('crates')])).toEqual([]);
  });

  it('flags a .crate one byte over the limit', async () => {
    bytesMock.mockResolvedValue(10 * MiB + 1);
    expect(await checkCratesPackageSize([makePkg('crates')])).toHaveLength(1);
  });

  it('skips a crate whose size cannot be determined', async () => {
    bytesMock.mockResolvedValue(null);
    expect(await checkCratesPackageSize([makePkg('crates')])).toEqual([]);
  });

  it('skips non-crates packages without probing their size', async () => {
    expect(await checkCratesPackageSize([makePkg('npm'), makePkg('pypi')])).toEqual([]);
    expect(bytesMock).not.toHaveBeenCalled();
  });
});
