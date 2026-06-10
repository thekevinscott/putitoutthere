/**
 * Unit tests for the version-independent-wheel detector. #401.
 *
 * Reads real on-disk `pyproject.toml` / `Cargo.toml` from a temp dir
 * (the function's whole job is parsing those manifests), so each case
 * writes the manifests it needs and asserts the verdict.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isVersionIndependentWheel } from './wheel-abi.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'piot-wheel-abi-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writePyproject(body: string): void {
  writeFileSync(join(dir, 'pyproject.toml'), body, 'utf8');
}

function writeCargo(body: string): void {
  writeFileSync(join(dir, 'Cargo.toml'), body, 'utf8');
}

// The detector takes (pkgPath, cwd); the manifests live directly in the
// temp dir, so pkgPath is '.'.
const detect = (): boolean => isVersionIndependentWheel('.', dir);

describe('isVersionIndependentWheel (#401)', () => {
  it('returns false when neither manifest exists', () => {
    expect(detect()).toBe(false);
  });

  it('detects bindings = "bin" in [tool.maturin]', () => {
    writePyproject('[project]\nname = "x"\n\n[tool.maturin]\nbindings = "bin"\n');
    expect(detect()).toBe(true);
  });

  it('does not treat other bindings values as version-independent', () => {
    writePyproject('[project]\nname = "x"\n\n[tool.maturin]\nbindings = "pyo3"\n');
    expect(detect()).toBe(false);
  });

  it('detects an abi3-pyXX feature on the Cargo pyo3 dependency (inline table)', () => {
    writeCargo(
      '[package]\nname = "x"\n\n[dependencies]\npyo3 = { version = "0.22", features = ["extension-module", "abi3-py38"] }\n',
    );
    expect(detect()).toBe(true);
  });

  it('detects a bare abi3 feature on the Cargo pyo3 dependency', () => {
    writeCargo('[package]\nname = "x"\n\n[dependencies.pyo3]\nversion = "0.22"\nfeatures = ["abi3"]\n');
    expect(detect()).toBe(true);
  });

  it('detects abi3 on the pyo3-ffi dependency', () => {
    writeCargo(
      '[package]\nname = "x"\n\n[dependencies]\npyo3-ffi = { version = "0.22", features = ["abi3-py39"] }\n',
    );
    expect(detect()).toBe(true);
  });

  it('detects abi3 routed through [tool.maturin].features', () => {
    writePyproject('[project]\nname = "x"\n\n[tool.maturin]\nfeatures = ["pyo3/abi3-py38"]\n');
    expect(detect()).toBe(true);
  });

  it('returns false for a plain extension-module pyo3 dependency (the fan must stay)', () => {
    writeCargo(
      '[package]\nname = "x"\n\n[dependencies]\npyo3 = { version = "0.22", features = ["extension-module"] }\n',
    );
    expect(detect()).toBe(false);
  });

  it('returns false for a pyo3 dependency declared as a bare version string', () => {
    writeCargo('[package]\nname = "x"\n\n[dependencies]\npyo3 = "0.22"\n');
    expect(detect()).toBe(false);
  });

  it('does not mistake a non-abi3 feature whose name merely contains "abi3"', () => {
    // `abi3-compat` is not a real pyo3 feature, but the anchored regex
    // must not match feature names that only embed the token.
    writeCargo(
      '[package]\nname = "x"\n\n[dependencies]\npyo3 = { version = "0.22", features = ["abi3-compat"] }\n',
    );
    expect(detect()).toBe(false);
  });

  it('does not throw on malformed TOML — falls back to false', () => {
    writePyproject('this is not = = valid toml [[[');
    writeCargo('also ] not [ valid');
    expect(detect()).toBe(false);
  });

  it('a bindings = "bin" pyproject wins even with a plain Cargo pyo3 dependency', () => {
    writePyproject('[project]\nname = "x"\n\n[tool.maturin]\nbindings = "bin"\n');
    writeCargo('[package]\nname = "x"\n\n[dependencies]\npyo3 = { version = "0.22", features = ["extension-module"] }\n');
    expect(detect()).toBe(true);
  });
});
