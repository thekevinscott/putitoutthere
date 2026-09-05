import { describe, expect, it, vi } from 'vitest';

import { checkPypiVersionSource } from '../preflight.js';
import { checkPypiVersion } from './check-pypi-version.js';
import type { CheckFinding } from './check-types.js';

vi.mock('../preflight.js');

import type { Package } from '../config.js';

const packages = [{ name: 'py', kind: 'pypi' }] as unknown as readonly Package[];

describe('checkPypiVersion', () => {
  it('returns no findings when the preflight is clean', async () => {
    vi.mocked(checkPypiVersionSource).mockResolvedValue([]);
    const findings: CheckFinding[] = [];
    await checkPypiVersion(packages, findings);
    expect(checkPypiVersionSource).toHaveBeenCalledWith(packages);
    expect(findings).toEqual([]);
  });

  it('maps a static-version finding to the coded dynamic-version remediation', async () => {
    vi.mocked(checkPypiVersionSource).mockResolvedValue([
      { package: 'py', pyprojectPath: 'py/pyproject.toml' },
    ]);
    const findings: CheckFinding[] = [];
    await checkPypiVersion(packages, findings);
    expect(findings).toEqual([
      {
        package: 'py',
        message:
          '[PIOT_PYPI_STATIC_VERSION] py/pyproject.toml declares a static `[project].version` literal. Use `[project].dynamic = ["version"]` with hatch-vcs (recommended), setuptools-scm, or the maturin Cargo.toml-driven path — putitoutthere does not edit pyproject.toml at release time, so a literal silently ships the previous release.',
      },
    ]);
  });
});
