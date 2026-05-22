/**
 * `requires-python` → concrete CPython version expansion. Issue #369.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_PYTHON_VERSION,
  expandRequiresPython,
  resolvePythonVersions,
} from './python-versions.js';

describe('expandRequiresPython', () => {
  it('expands `>=3.10` to the released CPython set it allows', () => {
    expect(expandRequiresPython('>=3.10')).toEqual(['3.10', '3.11', '3.12', '3.13']);
  });

  it('includes the latest released CPython for open-ended lower bounds (#375)', () => {
    expect(expandRequiresPython('>=3.11')).toContain('3.14');
  });

  it('honours an upper bound', () => {
    expect(expandRequiresPython('>=3.9,<3.12')).toEqual(['3.9', '3.10', '3.11']);
  });

  it('treats `<3.12` as exclusive', () => {
    expect(expandRequiresPython('>=3.11,<3.12')).toEqual(['3.11']);
  });

  it('handles a `~=` compatible-release clause', () => {
    expect(expandRequiresPython('~=3.11')).toEqual(['3.11', '3.12', '3.13']);
  });

  it('handles an exact `==` pin', () => {
    expect(expandRequiresPython('==3.12')).toEqual(['3.12']);
  });

  it('handles the arbitrary-equality `===` operator', () => {
    expect(expandRequiresPython('===3.12')).toEqual(['3.12']);
  });

  it('handles exclusive `>` and inclusive `<=` bounds', () => {
    expect(expandRequiresPython('>3.11,<=3.13')).toEqual(['3.12', '3.13']);
  });

  it('handles a `!=` exclusion', () => {
    expect(expandRequiresPython('>=3.10,!=3.12')).toEqual(['3.10', '3.11', '3.13']);
  });

  it('handles an `==3.*` wildcard', () => {
    expect(expandRequiresPython('==3.*')).toEqual([
      '3.8',
      '3.9',
      '3.10',
      '3.11',
      '3.12',
      '3.13',
    ]);
  });

  it('tolerates a patch component in the spec version', () => {
    expect(expandRequiresPython('>=3.11.0')).toEqual(['3.11', '3.12', '3.13']);
  });

  it('tolerates a bare-major spec version', () => {
    expect(expandRequiresPython('>=3')).toEqual([
      '3.8',
      '3.9',
      '3.10',
      '3.11',
      '3.12',
      '3.13',
    ]);
  });

  it('tolerates whitespace and a `<4` major bound', () => {
    expect(expandRequiresPython('>= 3.10, < 4')).toEqual(['3.10', '3.11', '3.12', '3.13']);
  });

  it('returns an empty array for an unparseable spec', () => {
    expect(expandRequiresPython('not-a-version')).toEqual([]);
  });

  it('returns an empty array for an empty spec', () => {
    expect(expandRequiresPython('')).toEqual([]);
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

  it('prefers an explicit python_versions override, sorted ascending', () => {
    writeFileSync(
      join(dir, 'pyproject.toml'),
      '[project]\nrequires-python = ">=3.10"\n',
      'utf8',
    );
    expect(
      resolvePythonVersions({ path: '.', python_versions: ['3.13', '3.9'] }, dir),
    ).toEqual(['3.9', '3.13']);
  });

  it('infers from requires-python when no override is given', () => {
    writeFileSync(
      join(dir, 'pyproject.toml'),
      '[project]\nrequires-python = ">=3.12"\n',
      'utf8',
    );
    expect(resolvePythonVersions({ path: '.' }, dir)).toEqual(['3.12', '3.13']);
  });

  it('falls back to the default when pyproject.toml is missing', () => {
    expect(resolvePythonVersions({ path: '.' }, dir)).toEqual([DEFAULT_PYTHON_VERSION]);
  });

  it('falls back to the default when requires-python is absent', () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n', 'utf8');
    expect(resolvePythonVersions({ path: '.' }, dir)).toEqual([DEFAULT_PYTHON_VERSION]);
  });

  it('falls back to the default when pyproject.toml has no [project] table', () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[build-system]\nrequires = []\n', 'utf8');
    expect(resolvePythonVersions({ path: '.' }, dir)).toEqual([DEFAULT_PYTHON_VERSION]);
  });

  it('falls back to the default when pyproject.toml is malformed TOML', () => {
    writeFileSync(join(dir, 'pyproject.toml'), 'this is not = = valid toml [[', 'utf8');
    expect(resolvePythonVersions({ path: '.' }, dir)).toEqual([DEFAULT_PYTHON_VERSION]);
  });

  it('falls back to the default when requires-python is unparseable', () => {
    writeFileSync(
      join(dir, 'pyproject.toml'),
      '[project]\nrequires-python = "banana"\n',
      'utf8',
    );
    expect(resolvePythonVersions({ path: '.' }, dir)).toEqual([DEFAULT_PYTHON_VERSION]);
  });
});
