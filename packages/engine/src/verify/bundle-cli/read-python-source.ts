/**
 * Read `[tool.maturin].python-source` (or the legacy `python_source`) from a
 * package's `pyproject.toml`, normalized (#451). maturin strips this dir from
 * the wheel layout, so it is subtracted from `stage_to`. Missing file, table or
 * key all resolve to `""`; both spellings exist because maturin accepted either.
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
