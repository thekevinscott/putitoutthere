import { describe, expect, it } from 'vitest';

import { cargoEnablesAbi3 } from './cargo-enables-abi3.js';

const withDeps = (dependencies: unknown): Record<string, unknown> => ({ dependencies });

describe('cargoEnablesAbi3', () => {
  it('is false without a Cargo manifest', () => {
    expect(cargoEnablesAbi3(null)).toBe(false);
  });

  it('is false without a [dependencies] table', () => {
    expect(cargoEnablesAbi3({ package: { name: 'x' } })).toBe(false);
  });

  it('detects abi3 on the pyo3 dependency', () => {
    expect(cargoEnablesAbi3(withDeps({ pyo3: { features: ['extension-module', 'abi3-py38'] } }))).toBe(true);
  });

  it('detects abi3 on the pyo3-ffi dependency', () => {
    expect(cargoEnablesAbi3(withDeps({ 'pyo3-ffi': { features: ['abi3-py39'] } }))).toBe(true);
  });

  it('ignores abi3 on an unrelated dependency', () => {
    expect(cargoEnablesAbi3(withDeps({ other: { features: ['abi3'] } }))).toBe(false);
  });

  it('is false for a plain extension-module pyo3 dependency', () => {
    expect(cargoEnablesAbi3(withDeps({ pyo3: { features: ['extension-module'] } }))).toBe(false);
  });

  it('is false for a null pyo3 dependency', () => {
    expect(cargoEnablesAbi3(withDeps({ pyo3: null }))).toBe(false);
  });

  it('is false for a pyo3 dependency declared as a bare version string', () => {
    expect(cargoEnablesAbi3(withDeps({ pyo3: '0.22' }))).toBe(false);
  });
});
