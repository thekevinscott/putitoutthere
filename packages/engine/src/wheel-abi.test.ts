/**
 * Unit tests for the version-independent-wheel detector. #401.
 *
 * `node:fs/promises` is mocked and the `pyproject.toml` / `Cargo.toml`
 * bytes are driven directly, so each case isolates the manifest-parsing
 * logic with no real temp dir. The real on-disk round trip is covered by
 * the integration and e2e tiers.
 */

import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isVersionIndependentWheel } from './wheel-abi.js';

vi.mock('node:fs/promises');

const readFileMock = vi.mocked(readFile);

const enoentError = (): NodeJS.ErrnoException =>
  Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

/**
 * Drive `readFile` from the manifest bytes each case supplies, keyed by
 * filename (not full path — so no OS-specific separator appears here). A
 * manifest that is not supplied rejects as absent (ENOENT).
 */
function withManifests(m: { pyproject?: string; cargo?: string }): void {
  readFileMock.mockImplementation((p: unknown) => {
    const path = String(p);
    if (path.endsWith('pyproject.toml')) {
      return m.pyproject !== undefined ? Promise.resolve(m.pyproject) : Promise.reject(enoentError());
    }
    if (path.endsWith('Cargo.toml')) {
      return m.cargo !== undefined ? Promise.resolve(m.cargo) : Promise.reject(enoentError());
    }
    return Promise.reject(enoentError());
  });
}

// The detector takes (pkgPath, cwd); values pass straight through to the
// mocked reads, so the literal strings are arbitrary.
const detect = (): Promise<boolean> => isVersionIndependentWheel('.', 'repo');

beforeEach(() => {
  vi.resetAllMocks();
});

describe('isVersionIndependentWheel (#401)', () => {
  it('returns false when neither manifest exists', async () => {
    withManifests({});
    expect(await detect()).toBe(false);
  });

  it('detects bindings = "bin" in [tool.maturin]', async () => {
    withManifests({ pyproject: '[project]\nname = "x"\n\n[tool.maturin]\nbindings = "bin"\n' });
    expect(await detect()).toBe(true);
  });

  it('does not treat other bindings values as version-independent', async () => {
    withManifests({ pyproject: '[project]\nname = "x"\n\n[tool.maturin]\nbindings = "pyo3"\n' });
    expect(await detect()).toBe(false);
  });

  it('detects an abi3-pyXX feature on the Cargo pyo3 dependency (inline table)', async () => {
    withManifests({
      cargo:
        '[package]\nname = "x"\n\n[dependencies]\npyo3 = { version = "0.22", features = ["extension-module", "abi3-py38"] }\n',
    });
    expect(await detect()).toBe(true);
  });

  it('detects a bare abi3 feature on the Cargo pyo3 dependency', async () => {
    withManifests({
      cargo: '[package]\nname = "x"\n\n[dependencies.pyo3]\nversion = "0.22"\nfeatures = ["abi3"]\n',
    });
    expect(await detect()).toBe(true);
  });

  it('detects abi3 on the pyo3-ffi dependency', async () => {
    withManifests({
      cargo:
        '[package]\nname = "x"\n\n[dependencies]\npyo3-ffi = { version = "0.22", features = ["abi3-py39"] }\n',
    });
    expect(await detect()).toBe(true);
  });

  it('detects abi3 routed through [tool.maturin].features', async () => {
    withManifests({
      pyproject: '[project]\nname = "x"\n\n[tool.maturin]\nfeatures = ["pyo3/abi3-py38"]\n',
    });
    expect(await detect()).toBe(true);
  });

  it('returns false for a plain extension-module pyo3 dependency (the fan must stay)', async () => {
    withManifests({
      cargo:
        '[package]\nname = "x"\n\n[dependencies]\npyo3 = { version = "0.22", features = ["extension-module"] }\n',
    });
    expect(await detect()).toBe(false);
  });

  it('returns false for a pyo3 dependency declared as a bare version string', async () => {
    withManifests({ cargo: '[package]\nname = "x"\n\n[dependencies]\npyo3 = "0.22"\n' });
    expect(await detect()).toBe(false);
  });

  it('does not mistake a non-abi3 feature whose name merely contains "abi3"', async () => {
    // `abi3-compat` is not a real pyo3 feature, but the anchored regex
    // must not match feature names that only embed the token.
    withManifests({
      cargo:
        '[package]\nname = "x"\n\n[dependencies]\npyo3 = { version = "0.22", features = ["abi3-compat"] }\n',
    });
    expect(await detect()).toBe(false);
  });

  it('does not throw on malformed TOML — falls back to false', async () => {
    withManifests({ pyproject: 'this is not = = valid toml [[[', cargo: 'also ] not [ valid' });
    expect(await detect()).toBe(false);
  });

  it('a bindings = "bin" pyproject wins even with a plain Cargo pyo3 dependency', async () => {
    withManifests({
      pyproject: '[project]\nname = "x"\n\n[tool.maturin]\nbindings = "bin"\n',
      cargo:
        '[package]\nname = "x"\n\n[dependencies]\npyo3 = { version = "0.22", features = ["extension-module"] }\n',
    });
    expect(await detect()).toBe(true);
  });
});
