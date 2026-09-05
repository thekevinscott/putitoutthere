import { describe, expect, it, vi } from 'vitest';

import { checkProvenanceMetadata } from '../preflight.js';
import { checkNpmRepository } from './check-npm-repository.js';
import type { CheckFinding } from './check-types.js';

vi.mock('../preflight.js');

import type { Package } from '../config.js';

const packages = [{ name: 'js', kind: 'npm' }] as unknown as readonly Package[];

describe('checkNpmRepository', () => {
  it('returns no findings when the preflight is clean', async () => {
    vi.mocked(checkProvenanceMetadata).mockResolvedValue([]);
    const findings: CheckFinding[] = [];
    await checkNpmRepository(packages, findings);
    expect(checkProvenanceMetadata).toHaveBeenCalledWith(packages);
    expect(findings).toEqual([]);
  });

  it('words a `missing` finding as "not found"', async () => {
    vi.mocked(checkProvenanceMetadata).mockResolvedValue([
      { package: 'js', packageJsonPath: 'js/package.json', reason: 'missing' },
    ]);
    const findings: CheckFinding[] = [];
    await checkNpmRepository(packages, findings);
    expect(findings).toEqual([
      {
        package: 'js',
        message:
          '[PIOT_NPM_MISSING_REPOSITORY] js/package.json not found. `npm publish --provenance` hard-requires a non-empty repository.url.',
      },
    ]);
  });

  it('words an `empty` finding as a missing-or-empty `repository`', async () => {
    vi.mocked(checkProvenanceMetadata).mockResolvedValue([
      { package: 'js', packageJsonPath: 'js/package.json', reason: 'empty' },
    ]);
    const findings: CheckFinding[] = [];
    await checkNpmRepository(packages, findings);
    expect(findings).toEqual([
      {
        package: 'js',
        message:
          '[PIOT_NPM_MISSING_REPOSITORY] js/package.json has missing or empty `repository`. `npm publish --provenance` hard-requires a non-empty repository.url.',
      },
    ]);
  });
});
