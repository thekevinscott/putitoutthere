import { describe, expect, it, vi } from 'vitest';

import { checkCratesMetadata } from '../preflight.js';
import { checkCratesPackageMetadata } from './check-crates-package-metadata.js';
import type { CheckFinding } from './check-types.js';

vi.mock('../preflight.js');

import type { Package } from '../config.js';

const packages = [{ name: 'rs', kind: 'crates' }] as unknown as readonly Package[];

describe('checkCratesPackageMetadata', () => {
  it('returns no findings when the preflight is clean', async () => {
    vi.mocked(checkCratesMetadata).mockResolvedValue([]);
    const findings: CheckFinding[] = [];
    await checkCratesPackageMetadata(packages, findings);
    expect(checkCratesMetadata).toHaveBeenCalledWith(packages);
    expect(findings).toEqual([]);
  });

  it('lists the missing Cargo.toml fields in one coded message', async () => {
    vi.mocked(checkCratesMetadata).mockResolvedValue([
      { package: 'rs', cargoTomlPath: 'rs/Cargo.toml', missing: ['description', 'license'] },
    ]);
    const findings: CheckFinding[] = [];
    await checkCratesPackageMetadata(packages, findings);
    expect(findings).toEqual([
      {
        package: 'rs',
        message:
          "[PIOT_CRATES_MISSING_METADATA] rs/Cargo.toml missing required Cargo.toml [package] field(s): description, license. crates.io rejects the publish after cargo's verification build.",
      },
    ]);
  });
});
