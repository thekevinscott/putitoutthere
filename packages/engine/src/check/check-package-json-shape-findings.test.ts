import { describe, expect, it, vi } from 'vitest';

import { checkPackageJsonShape } from '../preflight.js';
import { checkPackageJsonShapeFindings } from './check-package-json-shape-findings.js';
import type { CheckFinding } from './check-types.js';

vi.mock('../preflight.js');

import type { Package } from '../config.js';

const packages = [{ name: 'js', kind: 'npm' }] as unknown as readonly Package[];

describe('checkPackageJsonShapeFindings', () => {
  it('returns no findings when the preflight is clean', async () => {
    vi.mocked(checkPackageJsonShape).mockResolvedValue([]);
    const findings: CheckFinding[] = [];
    await checkPackageJsonShapeFindings(packages, findings);
    expect(checkPackageJsonShape).toHaveBeenCalledWith(packages);
    expect(findings).toEqual([]);
  });

  it('maps each preflight finding to `[code] path: detail`', async () => {
    vi.mocked(checkPackageJsonShape).mockResolvedValue([
      {
        package: 'js',
        packageJsonPath: 'js/package.json',
        code: 'PIOT_NPM_NAME_MISMATCH',
        detail: '"name" is "other", expected "js"',
      },
    ]);
    const findings: CheckFinding[] = [];
    await checkPackageJsonShapeFindings(packages, findings);
    expect(findings).toEqual([
      {
        package: 'js',
        message: '[PIOT_NPM_NAME_MISMATCH] js/package.json: "name" is "other", expected "js"',
      },
    ]);
  });
});
