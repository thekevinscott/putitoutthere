import { describe, expect, it, vi } from 'vitest';

import { checkPyprojectShape } from '../preflight.js';
import { checkPyprojectShapeFindings } from './check-pyproject-shape-findings.js';
import type { CheckFinding } from './check-types.js';

vi.mock('../preflight.js');

import type { Package } from '../config.js';

const packages = [{ name: 'py', kind: 'pypi' }] as unknown as readonly Package[];

describe('checkPyprojectShapeFindings', () => {
  it('returns no findings when the preflight is clean', async () => {
    vi.mocked(checkPyprojectShape).mockResolvedValue([]);
    const findings: CheckFinding[] = [];
    await checkPyprojectShapeFindings(packages, findings);
    expect(checkPyprojectShape).toHaveBeenCalledWith(packages);
    expect(findings).toEqual([]);
  });

  it('maps each preflight finding to `[code] path: detail`', async () => {
    vi.mocked(checkPyprojectShape).mockResolvedValue([
      {
        package: 'py',
        pyprojectPath: 'py/pyproject.toml',
        code: 'PIOT_PYPI_BUILD_BACKEND_MISMATCH',
        detail: 'declares hatchling but build = "maturin"',
      },
    ]);
    const findings: CheckFinding[] = [];
    await checkPyprojectShapeFindings(packages, findings);
    expect(findings).toEqual([
      {
        package: 'py',
        message: '[PIOT_PYPI_BUILD_BACKEND_MISMATCH] py/pyproject.toml: declares hatchling but build = "maturin"',
      },
    ]);
  });
});
