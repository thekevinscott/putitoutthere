import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cargoEnablesAbi3 } from './cargo-enables-abi3.js';
import { pyprojectMarksVersionIndependent } from './pyproject-marks-version-independent.js';
import { readToml } from './read-toml.js';
import { isVersionIndependentWheel } from './wheel-abi.js';

vi.mock('./cargo-enables-abi3.js');
vi.mock('./pyproject-marks-version-independent.js');
vi.mock('./read-toml.js');

const readMock = vi.mocked(readToml);
const pyprojectMock = vi.mocked(pyprojectMarksVersionIndependent);
const cargoMock = vi.mocked(cargoEnablesAbi3);

const pyproject = { tool: {} };
const cargo = { dependencies: {} };

beforeEach(() => {
  vi.resetAllMocks();
  readMock.mockImplementation((path) =>
    Promise.resolve(path.endsWith('pyproject.toml') ? pyproject : cargo),
  );
});

describe('isVersionIndependentWheel (#401)', () => {
  it('reads both manifests from the package directory under cwd', async () => {
    await isVersionIndependentWheel('py/pkg', 'repo');
    expect(readMock).toHaveBeenCalledWith(expect.stringMatching(/^repo[\\/]py[\\/]pkg[\\/]pyproject\.toml$/));
    expect(readMock).toHaveBeenCalledWith(expect.stringMatching(/^repo[\\/]py[\\/]pkg[\\/]Cargo\.toml$/));
  });

  it('is true when pyproject marks the wheel version-independent, without reading Cargo.toml', async () => {
    pyprojectMock.mockReturnValue(true);
    expect(await isVersionIndependentWheel('.', 'repo')).toBe(true);
    expect(pyprojectMock).toHaveBeenCalledWith(pyproject);
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(cargoMock).not.toHaveBeenCalled();
  });

  it('falls back to the Cargo manifest when pyproject does not decide', async () => {
    pyprojectMock.mockReturnValue(false);
    cargoMock.mockReturnValue(true);
    expect(await isVersionIndependentWheel('.', 'repo')).toBe(true);
    expect(cargoMock).toHaveBeenCalledWith(cargo);
  });

  it('is false when neither manifest marks it', async () => {
    pyprojectMock.mockReturnValue(false);
    cargoMock.mockReturnValue(false);
    expect(await isVersionIndependentWheel('.', 'repo')).toBe(false);
  });
});
