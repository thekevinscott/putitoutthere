/**
 * Unit tests for the version-independent-wheel detector. #401.
 *
 * `node:fs` is mocked and the `pyproject.toml` / `Cargo.toml` bytes are
 * driven directly, so each case isolates the manifest-parsing logic with no
 * real temp dir. The real on-disk round trip is covered by the integration
 * and e2e tiers.
 */

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isVersionIndependentWheel } from './wheel-abi.js';

vi.mock('node:fs');

const readFileMock = vi.mocked(readFileSync);

const ENOENT = (): never => {
  throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
};

/**
 * Drive `readFileSync` from the manifest bytes each case supplies, keyed by
 * filename (not full path — so no OS-specific separator appears here). A
 * manifest that is not supplied reads as absent (ENOENT).
 */
function withManifests(m: { pyproject?: string; cargo?: string }): void {
  readFileMock.mockImplementation((p) => {
    const path = String(p);
    if (path.endsWith('pyproject.toml')) {return m.pyproject ?? ENOENT();}
    if (path.endsWith('Cargo.toml')) {return m.cargo ?? ENOENT();}
    return ENOENT();
  });
}

// The detector takes (pkgPath, cwd); values pass straight through to the
// mocked reads, so the literal strings are arbitrary.
const detect = (): boolean => isVersionIndependentWheel('.', 'repo');

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isVersionIndependentWheel (#401)', () => {
  it('returns false when neither manifest exists', () => {
    withManifests({});
    expect(detect()).toBe(false);
  });

  it('detects bindings = "bin" in [tool.maturin]', () => {
    withManifests({ pyproject: '[project]\nname = "x"\n\n[tool.maturin]\nbindings = "bin"\n' });
    expect(detect()).toBe(true);
  });

  it('does not treat other bindings values as version-independent', () => {
    withManifests({ pyproject: '[project]\nname = "x"\n\n[tool.maturin]\nbindings = "pyo3"\n' });
    expect(detect()).toBe(false);
  });

  it('detects an abi3-pyXX feature on the Cargo pyo3 dependency (inline table)', () => {
    withManifests({
      cargo:
        '[package]\nname = "x"\n\n[dependencies]\npyo3 = { version = "0.22", features = ["extension-module", "abi3-py38"] }\n',
    });
    expect(detect()).toBe(true);
  });

  it('detects a bare abi3 feature on the Cargo pyo3 dependency', () => {
    withManifests({
      cargo: '[package]\nname = "x"\n\n[dependencies.pyo3]\nversion = "0.22"\nfeatures = ["abi3"]\n',
    });
    expect(detect()).toBe(true);
  });

  it('detects abi3 on the pyo3-ffi dependency', () => {
    withManifests({
      cargo:
        '[package]\nname = "x"\n\n[dependencies]\npyo3-ffi = { version = "0.22", features = ["abi3-py39"] }\n',
    });
    expect(detect()).toBe(true);
  });

  it('detects abi3 routed through [tool.maturin].features', () => {
    withManifests({
      pyproject: '[project]\nname = "x"\n\n[tool.maturin]\nfeatures = ["pyo3/abi3-py38"]\n',
    });
    expect(detect()).toBe(true);
  });

  it('returns false for a plain extension-module pyo3 dependency (the fan must stay)', () => {
    withManifests({
      cargo:
        '[package]\nname = "x"\n\n[dependencies]\npyo3 = { version = "0.22", features = ["extension-module"] }\n',
    });
    expect(detect()).toBe(false);
  });

  it('returns false for a pyo3 dependency declared as a bare version string', () => {
    withManifests({ cargo: '[package]\nname = "x"\n\n[dependencies]\npyo3 = "0.22"\n' });
    expect(detect()).toBe(false);
  });

  it('does not mistake a non-abi3 feature whose name merely contains "abi3"', () => {
    // `abi3-compat` is not a real pyo3 feature, but the anchored regex
    // must not match feature names that only embed the token.
    withManifests({
      cargo:
        '[package]\nname = "x"\n\n[dependencies]\npyo3 = { version = "0.22", features = ["abi3-compat"] }\n',
    });
    expect(detect()).toBe(false);
  });

  it('does not throw on malformed TOML — falls back to false', () => {
    withManifests({ pyproject: 'this is not = = valid toml [[[', cargo: 'also ] not [ valid' });
    expect(detect()).toBe(false);
  });

  it('a bindings = "bin" pyproject wins even with a plain Cargo pyo3 dependency', () => {
    withManifests({
      pyproject: '[project]\nname = "x"\n\n[tool.maturin]\nbindings = "bin"\n',
      cargo:
        '[package]\nname = "x"\n\n[dependencies]\npyo3 = { version = "0.22", features = ["extension-module"] }\n',
    });
    expect(detect()).toBe(true);
  });
});
