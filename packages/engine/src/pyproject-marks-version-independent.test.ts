import { describe, expect, it } from 'vitest';

import { pyprojectMarksVersionIndependent } from './pyproject-marks-version-independent.js';

const withMaturin = (maturin: unknown): Record<string, unknown> => ({ tool: { maturin } });

describe('pyprojectMarksVersionIndependent', () => {
  it('is false without a pyproject', () => {
    expect(pyprojectMarksVersionIndependent(null)).toBe(false);
  });

  it('is false without a [tool.maturin] table', () => {
    expect(pyprojectMarksVersionIndependent({ project: { name: 'x' } })).toBe(false);
  });

  it('detects bindings = "bin"', () => {
    expect(pyprojectMarksVersionIndependent(withMaturin({ bindings: 'bin' }))).toBe(true);
  });

  it('does not treat other bindings values as version-independent', () => {
    expect(pyprojectMarksVersionIndependent(withMaturin({ bindings: 'pyo3' }))).toBe(false);
  });

  it('detects abi3 routed through [tool.maturin].features', () => {
    expect(pyprojectMarksVersionIndependent(withMaturin({ features: ['pyo3/abi3-py38'] }))).toBe(true);
  });
});
