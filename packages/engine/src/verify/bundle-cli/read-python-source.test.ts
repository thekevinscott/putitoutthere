/**
 * `readPythonSource` — read + normalize `[tool.maturin].python-source`
 * from `pyproject.toml`, honoring the legacy `python_source` spelling and
 * the missing-file / missing-table / missing-key → `""` paths (#451).
 *
 * Unit-isolated: `node:fs` is mocked so the branches are driven by the
 * pyproject presence + body the mock returns, not by a temp dir on disk.
 * Real-IO coverage lives in the verify integration/e2e tiers.
 */

import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readPythonSource } from './read-python-source.js';

vi.mock('node:fs');

const existsSyncMock = vi.mocked(existsSync);
const readFileSyncMock = vi.mocked(readFileSync);

/** Drive the source's fs reads: pyproject.toml present with `body`, or absent. */
function withPyproject(body: string | null): void {
  existsSyncMock.mockReturnValue(body !== null);
  readFileSyncMock.mockReturnValue(body ?? '');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readPythonSource', () => {
  it('returns "" when there is no pyproject.toml', () => {
    withPyproject(null);
    expect(readPythonSource('/pkg')).toBe('');
  });

  it('reads [tool.maturin].python-source', () => {
    withPyproject('[tool.maturin]\npython-source = "python"\n');
    expect(readPythonSource('/pkg')).toBe('python');
  });

  it('honors the legacy python_source spelling', () => {
    withPyproject('[tool.maturin]\npython_source = "src"\n');
    expect(readPythonSource('/pkg')).toBe('src');
  });

  it('normalizes a leading ./ and trailing slashes', () => {
    withPyproject('[tool.maturin]\npython-source = "./py/pkg/"\n');
    expect(readPythonSource('/pkg')).toBe('py/pkg');
  });

  it('returns "" when [tool.maturin] has neither key', () => {
    withPyproject('[tool.maturin]\nstrip = true\n');
    expect(readPythonSource('/pkg')).toBe('');
  });

  it('returns "" when there is a [tool] table but no maturin', () => {
    withPyproject('[tool.black]\nline-length = 100\n');
    expect(readPythonSource('/pkg')).toBe('');
  });

  it('returns "" when there is no [tool] table at all', () => {
    withPyproject('[project]\nname = "demo"\n');
    expect(readPythonSource('/pkg')).toBe('');
  });

  it('returns "" when python-source is not a string', () => {
    withPyproject('[tool.maturin]\npython-source = 3\n');
    expect(readPythonSource('/pkg')).toBe('');
  });
});
