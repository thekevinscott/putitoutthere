/**
 * Read `[tool.maturin].python-source` (or the legacy `python_source`
 * spelling) from a package's `pyproject.toml`, normalized (#451).
 *
 * The engine analogue of the inline `python3 - <<PY … tomllib …` block in
 * `.github/workflows/_matrix.yml`'s "bundle_cli — verify wheel contains …"
 * step. maturin strips this directory from the wheel layout, so it is
 * subtracted from the front of `stage_to` before the binary path is built
 * (see `computeStageSuffix`). Missing file, missing table, or missing key
 * all resolve to `""` — the same "unset ⇒ leave stage_suffix unchanged"
 * behaviour as the bash. Both spellings are honoured because maturin has
 * accepted either across releases. Normalization mirrors the bash: drop a
 * single leading `./` and any trailing slashes.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { pathExists } from '../../utils/path-exists.js';

interface MaturinPyproject {
  tool?: { maturin?: { 'python-source'?: unknown; python_source?: unknown } };
}

export async function readPythonSource(pkgDir: string): Promise<string> {
  const pyproject = join(pkgDir, 'pyproject.toml');
  if (!(await pathExists(pyproject))) {
    return '';
  }
  const cfg = parseToml(await readFile(pyproject, 'utf8')) as unknown as MaturinPyproject;
  const maturin = cfg.tool?.maturin;
  const raw = maturin?.['python-source'] ?? maturin?.python_source;
  const src = typeof raw === 'string' ? raw : '';
  return src.replace(/^\.\//, '').replace(/\/+$/, '');
}
