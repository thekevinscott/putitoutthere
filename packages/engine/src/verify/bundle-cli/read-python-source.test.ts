/**
 * `readPythonSource` — read + normalize `[tool.maturin].python-source`
 * from `pyproject.toml`, honoring the legacy `python_source` spelling and
 * the missing-file / missing-table / missing-key → `""` paths (#451).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readPythonSource } from './read-python-source.js';

let dir: string;

function writePyproject(body: string): void {
  writeFileSync(join(dir, 'pyproject.toml'), body);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'piot-python-source-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readPythonSource', () => {
  it('returns "" when there is no pyproject.toml', () => {
    expect(readPythonSource(dir)).toBe('');
  });

  it('reads [tool.maturin].python-source', () => {
    writePyproject('[tool.maturin]\npython-source = "python"\n');
    expect(readPythonSource(dir)).toBe('python');
  });

  it('honors the legacy python_source spelling', () => {
    writePyproject('[tool.maturin]\npython_source = "src"\n');
    expect(readPythonSource(dir)).toBe('src');
  });

  it('normalizes a leading ./ and trailing slashes', () => {
    writePyproject('[tool.maturin]\npython-source = "./py/pkg/"\n');
    expect(readPythonSource(dir)).toBe('py/pkg');
  });

  it('returns "" when [tool.maturin] has neither key', () => {
    writePyproject('[tool.maturin]\nstrip = true\n');
    expect(readPythonSource(dir)).toBe('');
  });

  it('returns "" when there is a [tool] table but no maturin', () => {
    writePyproject('[tool.black]\nline-length = 100\n');
    expect(readPythonSource(dir)).toBe('');
  });

  it('returns "" when there is no [tool] table at all', () => {
    writePyproject('[project]\nname = "demo"\n');
    expect(readPythonSource(dir)).toBe('');
  });

  it('returns "" when python-source is not a string', () => {
    writePyproject('[tool.maturin]\npython-source = 3\n');
    expect(readPythonSource(dir)).toBe('');
  });
});
