/**
 * `readPythonSource` — read + normalize `[tool.maturin].python-source`
 * from `pyproject.toml`, honoring the legacy `python_source` spelling and
 * the missing-file / missing-table / missing-key → `""` paths (#451).
 *
 * Unit-isolated: `node:fs/promises` is mocked so the branches are driven by
 * the pyproject presence + body the mock returns, not by a temp dir on disk.
 * Real-IO coverage lives in the verify integration/e2e tiers.
 */

import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import { readPythonSource } from './read-python-source.js';

vi.mock('node:fs/promises');

const statMock = vi.mocked(stat);
const readFileMock = vi.mocked(readFile);

// `pathExists` returns false when `stat` rejects; ENOENT drives the
// missing-file branch.
const ENOENT = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

/** Drive the source's fs reads: pyproject.toml present with `body`, or absent. */
function withPyproject(body: string | null): void {
  if (body === null) {
    statMock.mockRejectedValue(ENOENT);
    return;
  }
  statMock.mockResolvedValue({} as never);
  readFileMock.mockResolvedValue(body);
}

describe('readPythonSource', () => {
  it('returns "" when there is no pyproject.toml', async () => {
    withPyproject(null);
    expect(await readPythonSource('/pkg')).toBe('');
  });

  it('reads [tool.maturin].python-source', async () => {
    withPyproject('[tool.maturin]\npython-source = "python"\n');
    expect(await readPythonSource('/pkg')).toBe('python');
  });

  it('honors the legacy python_source spelling', async () => {
    withPyproject('[tool.maturin]\npython_source = "src"\n');
    expect(await readPythonSource('/pkg')).toBe('src');
  });

  it('normalizes a leading ./ and trailing slashes', async () => {
    withPyproject('[tool.maturin]\npython-source = "./py/pkg/"\n');
    expect(await readPythonSource('/pkg')).toBe('py/pkg');
  });

  it('returns "" when [tool.maturin] has neither key', async () => {
    withPyproject('[tool.maturin]\nstrip = true\n');
    expect(await readPythonSource('/pkg')).toBe('');
  });

  it('returns "" when there is a [tool] table but no maturin', async () => {
    withPyproject('[tool.black]\nline-length = 100\n');
    expect(await readPythonSource('/pkg')).toBe('');
  });

  it('returns "" when there is no [tool] table at all', async () => {
    withPyproject('[project]\nname = "demo"\n');
    expect(await readPythonSource('/pkg')).toBe('');
  });

  it('returns "" when python-source is not a string', async () => {
    withPyproject('[tool.maturin]\npython-source = 3\n');
    expect(await readPythonSource('/pkg')).toBe('');
  });
});
