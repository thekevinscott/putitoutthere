/**
 * `requires-python` → concrete CPython version expansion. Issue #369.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_PYTHON_VERSION,
  RELEASED_CPYTHON_VERSIONS,
  expandRequiresPython,
  knownPythonVersions,
  resolvePythonVersions,
} from './python-versions.js';

describe('expandRequiresPython', () => {
  it('expands `>=3.10` to the released CPython set it allows', async () => {
    await expect(expandRequiresPython('>=3.10')).resolves.toEqual([
      '3.10',
      '3.11',
      '3.12',
      '3.13',
      '3.14',
    ]);
  });

  it('includes the latest released CPython for open-ended lower bounds (#375)', async () => {
    await expect(expandRequiresPython('>=3.11')).resolves.toContain('3.14');
  });

  it('uses the checked-in released CPython list (#375)', () => {
    expect(knownPythonVersions()).toEqual([...RELEASED_CPYTHON_VERSIONS]);
  });

  it('honours an upper bound', async () => {
    await expect(expandRequiresPython('>=3.9,<3.12')).resolves.toEqual(['3.9', '3.10', '3.11']);
  });

  it('treats `<3.12` as exclusive', async () => {
    await expect(expandRequiresPython('>=3.11,<3.12')).resolves.toEqual(['3.11']);
  });

  it('handles a `~=` compatible-release clause', async () => {
    await expect(expandRequiresPython('~=3.11')).resolves.toEqual(['3.11', '3.12', '3.13', '3.14']);
  });

  it('handles an exact `==` pin', async () => {
    await expect(expandRequiresPython('==3.12')).resolves.toEqual(['3.12']);
  });

  it('handles the arbitrary-equality `===` operator', async () => {
    await expect(expandRequiresPython('===3.12')).resolves.toEqual(['3.12']);
  });

  it('handles exclusive `>` and inclusive `<=` bounds', async () => {
    await expect(expandRequiresPython('>3.11,<=3.13')).resolves.toEqual(['3.12', '3.13']);
  });

  it('handles a `!=` exclusion', async () => {
    await expect(expandRequiresPython('>=3.10,!=3.12')).resolves.toEqual([
      '3.10',
      '3.11',
      '3.13',
      '3.14',
    ]);
  });

  it('handles an `==3.*` wildcard', async () => {
    await expect(expandRequiresPython('==3.*')).resolves.toEqual([
      '3.8',
      '3.9',
      '3.10',
      '3.11',
      '3.12',
      '3.13',
      '3.14',
    ]);
  });

  it('tolerates a patch component in the spec version', async () => {
    await expect(expandRequiresPython('>=3.11.0')).resolves.toEqual(['3.11', '3.12', '3.13', '3.14']);
  });

  it('tolerates a bare-major spec version', async () => {
    await expect(expandRequiresPython('>=3')).resolves.toEqual([
      '3.8',
      '3.9',
      '3.10',
      '3.11',
      '3.12',
      '3.13',
      '3.14',
    ]);
  });

  it('tolerates whitespace and a `<4` major bound', async () => {
    await expect(expandRequiresPython('>= 3.10, < 4')).resolves.toEqual([
      '3.10',
      '3.11',
      '3.12',
      '3.13',
      '3.14',
    ]);
  });

  it('returns an empty array for an unparseable spec', async () => {
    await expect(expandRequiresPython('not-a-version')).resolves.toEqual([]);
  });

  it('returns an empty array for an empty spec', async () => {
    await expect(expandRequiresPython('')).resolves.toEqual([]);
  });
});

describe('resolvePythonVersions', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pyver-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('prefers an explicit python_versions override, sorted ascending', async () => {
    writeFileSync(
      join(dir, 'pyproject.toml'),
      '[project]\nrequires-python = ">=3.10"\n',
      'utf8',
    );
    await expect(
      resolvePythonVersions({ path: '.', python_versions: ['3.13', '3.9'] }, dir),
    ).resolves.toEqual(['3.9', '3.13']);
  });

  it('infers from requires-python when no override is given', async () => {
    writeFileSync(
      join(dir, 'pyproject.toml'),
      '[project]\nrequires-python = ">=3.12"\n',
      'utf8',
    );
    await expect(resolvePythonVersions({ path: '.' }, dir)).resolves.toEqual(['3.12', '3.13', '3.14']);
  });

  it('falls back to the default when pyproject.toml is missing', async () => {
    await expect(resolvePythonVersions({ path: '.' }, dir)).resolves.toEqual([DEFAULT_PYTHON_VERSION]);
  });

  it('falls back to the default when requires-python is absent', async () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n', 'utf8');
    await expect(resolvePythonVersions({ path: '.' }, dir)).resolves.toEqual([DEFAULT_PYTHON_VERSION]);
  });

  it('falls back to the default when pyproject.toml has no [project] table', async () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[build-system]\nrequires = []\n', 'utf8');
    await expect(resolvePythonVersions({ path: '.' }, dir)).resolves.toEqual([DEFAULT_PYTHON_VERSION]);
  });

  it('falls back to the default when pyproject.toml is malformed TOML', async () => {
    writeFileSync(join(dir, 'pyproject.toml'), 'this is not = = valid toml [[', 'utf8');
    await expect(resolvePythonVersions({ path: '.' }, dir)).resolves.toEqual([DEFAULT_PYTHON_VERSION]);
  });

  it('falls back to the default when requires-python is unparseable', async () => {
    writeFileSync(
      join(dir, 'pyproject.toml'),
      '[project]\nrequires-python = "banana"\n',
      'utf8',
    );
    await expect(resolvePythonVersions({ path: '.' }, dir)).resolves.toEqual([DEFAULT_PYTHON_VERSION]);
  });
});
