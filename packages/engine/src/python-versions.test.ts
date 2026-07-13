/**
 * `requires-python` → concrete CPython version expansion. Issue #369.
 */

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PYTHON_VERSION,
  RELEASED_CPYTHON_VERSIONS,
  expandRequiresPython,
  resolvePythonVersions,
} from './python-versions.js';

// `resolvePythonVersions`'s only collaborator is `node:fs` (reading
// pyproject.toml); mock it so this isolates the resolution logic — override /
// inference / fallback — from disk. The real read is covered at the
// integration + e2e tiers.
vi.mock('node:fs');

const readFileMock = vi.mocked(readFileSync);

describe('expandRequiresPython', () => {
  it('expands `>=3.10` to the released CPython set it allows', () => {
    expect(expandRequiresPython('>=3.10')).toEqual([
      '3.10',
      '3.11',
      '3.12',
      '3.13',
      '3.14',
    ]);
  });

  it('includes the latest released CPython for open-ended lower bounds (#375)', () => {
    expect(expandRequiresPython('>=3.11')).toContain('3.14');
  });

  it('uses the checked-in released CPython list (#375)', () => {
    expect(expandRequiresPython('==3.*')).toEqual([...RELEASED_CPYTHON_VERSIONS]);
  });

  it('honours an upper bound', () => {
    expect(expandRequiresPython('>=3.9,<3.12')).toEqual(['3.9', '3.10', '3.11']);
  });

  it('treats `<3.12` as exclusive', () => {
    expect(expandRequiresPython('>=3.11,<3.12')).toEqual(['3.11']);
  });

  it('handles a `~=` compatible-release clause', () => {
    expect(expandRequiresPython('~=3.11')).toEqual(['3.11', '3.12', '3.13', '3.14']);
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
    expect(expandRequiresPython('>=3.10,!=3.12')).toEqual([
      '3.10',
      '3.11',
      '3.13',
      '3.14',
    ]);
  });

  it('handles an `==3.*` wildcard', () => {
    expect(expandRequiresPython('==3.*')).toEqual([
      '3.8',
      '3.9',
      '3.10',
      '3.11',
      '3.12',
      '3.13',
      '3.14',
    ]);
  });

  it('tolerates a patch component in the spec version', () => {
    expect(expandRequiresPython('>=3.11.0')).toEqual(['3.11', '3.12', '3.13', '3.14']);
  });

  it('tolerates a bare-major spec version', () => {
    expect(expandRequiresPython('>=3')).toEqual([
      '3.8',
      '3.9',
      '3.10',
      '3.11',
      '3.12',
      '3.13',
      '3.14',
    ]);
  });

  it('tolerates whitespace and a `<4` major bound', () => {
    expect(expandRequiresPython('>= 3.10, < 4')).toEqual([
      '3.10',
      '3.11',
      '3.12',
      '3.13',
      '3.14',
    ]);
  });

  it('returns an empty array for an unparseable spec', () => {
    expect(expandRequiresPython('not-a-version')).toEqual([]);
  });

  it('returns an empty array for an empty spec', () => {
    expect(expandRequiresPython('')).toEqual([]);
  });
});

describe('resolvePythonVersions', () => {
  beforeEach(() => {
    readFileMock.mockReset();
  });

  // `cwd`/`path` are opaque to the mocked reader; the pyproject *contents* it
  // returns (or the error it throws) are what drives each branch.
  const pyproject = (contents: string): void => {
    readFileMock.mockReturnValue(contents);
  };
  const missingPyproject = (): void => {
    readFileMock.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    });
  };

  it('prefers an explicit python_versions override, sorted ascending', () => {
    pyproject('[project]\nrequires-python = ">=3.10"\n');
    expect(
      resolvePythonVersions({ path: '.', python_versions: ['3.13', '3.9'] }, '/repo'),
    ).toEqual(['3.9', '3.13']);
  });

  it('infers from requires-python when no override is given', () => {
    pyproject('[project]\nrequires-python = ">=3.12"\n');
    expect(resolvePythonVersions({ path: '.' }, '/repo')).toEqual(['3.12', '3.13', '3.14']);
  });

  it('falls back to the default when pyproject.toml is missing', () => {
    missingPyproject();
    expect(resolvePythonVersions({ path: '.' }, '/repo')).toEqual([DEFAULT_PYTHON_VERSION]);
  });

  it('falls back to the default when requires-python is absent', () => {
    pyproject('[project]\nname = "x"\n');
    expect(resolvePythonVersions({ path: '.' }, '/repo')).toEqual([DEFAULT_PYTHON_VERSION]);
  });

  it('falls back to the default when pyproject.toml has no [project] table', () => {
    pyproject('[build-system]\nrequires = []\n');
    expect(resolvePythonVersions({ path: '.' }, '/repo')).toEqual([DEFAULT_PYTHON_VERSION]);
  });

  it('falls back to the default when pyproject.toml is malformed TOML', () => {
    pyproject('this is not = = valid toml [[');
    expect(resolvePythonVersions({ path: '.' }, '/repo')).toEqual([DEFAULT_PYTHON_VERSION]);
  });

  it('falls back to the default when requires-python is unparseable', () => {
    pyproject('[project]\nrequires-python = "banana"\n');
    expect(resolvePythonVersions({ path: '.' }, '/repo')).toEqual([DEFAULT_PYTHON_VERSION]);
  });
});
