import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from './config.js';
import { readDeclaredRepoUrl } from './read-declared-repo-url.js';
import { readJson } from './read-json.js';
import { readToml } from './read-toml.js';

vi.mock('./read-json.js');
vi.mock('./read-toml.js');

const readJsonMock = vi.mocked(readJson);
const readTomlMock = vi.mocked(readToml);

function pkg(kind: Package['kind']): Package {
  return {
    name: `${kind}-pkg`,
    kind,
    path: '/repo/pkg',
    globs: ['**'],
    depends_on: [],
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
  } as Package;
}

beforeEach(() => {
  readJsonMock.mockReset();
  readTomlMock.mockReset();
});

describe('readDeclaredRepoUrl: npm', () => {
  const manifestPath = join('/repo/pkg', 'package.json');

  it('reads package.json and trims a string repository', async () => {
    readJsonMock.mockResolvedValue({ repository: '  https://github.com/acme/widget  ' });
    await expect(readDeclaredRepoUrl(pkg('npm'))).resolves.toEqual({
      url: 'https://github.com/acme/widget',
      manifestPath,
    });
    expect(readJsonMock).toHaveBeenCalledWith(manifestPath);
    expect(readTomlMock).not.toHaveBeenCalled();
  });

  it('trims repository.url from the object form', async () => {
    readJsonMock.mockResolvedValue({ repository: { type: 'git', url: ' git+https://github.com/acme/widget.git ' } });
    await expect(readDeclaredRepoUrl(pkg('npm'))).resolves.toEqual({
      url: 'git+https://github.com/acme/widget.git',
      manifestPath,
    });
  });

  it('returns null when package.json is unreadable', async () => {
    readJsonMock.mockResolvedValue(null);
    await expect(readDeclaredRepoUrl(pkg('npm'))).resolves.toBeNull();
  });

  it('returns null for a whitespace-only string repository', async () => {
    readJsonMock.mockResolvedValue({ repository: '   ' });
    await expect(readDeclaredRepoUrl(pkg('npm'))).resolves.toBeNull();
  });

  it('returns null for an object repository with no usable url', async () => {
    readJsonMock.mockResolvedValue({ repository: { type: 'git' } });
    await expect(readDeclaredRepoUrl(pkg('npm'))).resolves.toBeNull();
  });

  it('returns null for an object repository whose url is whitespace', async () => {
    readJsonMock.mockResolvedValue({ repository: { url: '  ' } });
    await expect(readDeclaredRepoUrl(pkg('npm'))).resolves.toBeNull();
  });

  it('returns null for a null repository', async () => {
    readJsonMock.mockResolvedValue({ repository: null });
    await expect(readDeclaredRepoUrl(pkg('npm'))).resolves.toBeNull();
  });

  it('returns null when repository is absent', async () => {
    readJsonMock.mockResolvedValue({ name: 'widget' });
    await expect(readDeclaredRepoUrl(pkg('npm'))).resolves.toBeNull();
  });
});

describe('readDeclaredRepoUrl: crates', () => {
  const manifestPath = join('/repo/pkg', 'Cargo.toml');

  it('reads Cargo.toml and trims [package].repository', async () => {
    readTomlMock.mockResolvedValue({ package: { repository: ' https://github.com/acme/widget ' } });
    await expect(readDeclaredRepoUrl(pkg('crates'))).resolves.toEqual({
      url: 'https://github.com/acme/widget',
      manifestPath,
    });
    expect(readTomlMock).toHaveBeenCalledWith(manifestPath);
    expect(readJsonMock).not.toHaveBeenCalled();
  });

  it('returns null when Cargo.toml is unreadable', async () => {
    readTomlMock.mockResolvedValue(null);
    await expect(readDeclaredRepoUrl(pkg('crates'))).resolves.toBeNull();
  });

  it('returns null for a manifest with no [package] table', async () => {
    readTomlMock.mockResolvedValue({ workspace: { members: ['a'] } });
    await expect(readDeclaredRepoUrl(pkg('crates'))).resolves.toBeNull();
  });

  it('returns null for a whitespace-only repository', async () => {
    readTomlMock.mockResolvedValue({ package: { repository: '  ' } });
    await expect(readDeclaredRepoUrl(pkg('crates'))).resolves.toBeNull();
  });

  it('returns null for a non-string repository', async () => {
    readTomlMock.mockResolvedValue({ package: { repository: { workspace: true } } });
    await expect(readDeclaredRepoUrl(pkg('crates'))).resolves.toBeNull();
  });
});

describe('readDeclaredRepoUrl: pypi', () => {
  const manifestPath = join('/repo/pkg', 'pyproject.toml');

  it('reads pyproject.toml and trims [project.urls].Repository', async () => {
    readTomlMock.mockResolvedValue({ project: { urls: { Repository: ' https://github.com/acme/widget ' } } });
    await expect(readDeclaredRepoUrl(pkg('pypi'))).resolves.toEqual({
      url: 'https://github.com/acme/widget',
      manifestPath,
    });
    expect(readTomlMock).toHaveBeenCalledWith(manifestPath);
    expect(readJsonMock).not.toHaveBeenCalled();
  });

  it.each([
    ['Repository', 'repository'],
    ['repository', 'Source'],
    ['Source', 'source'],
    ['source', 'Homepage'],
    ['Homepage', 'homepage'],
  ])('prefers %s over %s', async (winner, loser) => {
    readTomlMock.mockResolvedValue({
      project: { urls: { [loser]: 'https://example.com/loser', [winner]: 'https://example.com/winner' } },
    });
    await expect(readDeclaredRepoUrl(pkg('pypi'))).resolves.toEqual({
      url: 'https://example.com/winner',
      manifestPath,
    });
  });

  it('accepts a lowercase homepage as the last fallback', async () => {
    readTomlMock.mockResolvedValue({ project: { urls: { homepage: 'https://example.com/home' } } });
    await expect(readDeclaredRepoUrl(pkg('pypi'))).resolves.toEqual({
      url: 'https://example.com/home',
      manifestPath,
    });
  });

  it('skips a whitespace-only label and falls through to the next one', async () => {
    readTomlMock.mockResolvedValue({
      project: { urls: { Repository: '   ', Source: 'https://example.com/source' } },
    });
    await expect(readDeclaredRepoUrl(pkg('pypi'))).resolves.toEqual({
      url: 'https://example.com/source',
      manifestPath,
    });
  });

  it('ignores labels outside the accepted set', async () => {
    readTomlMock.mockResolvedValue({ project: { urls: { Documentation: 'https://example.com/docs' } } });
    await expect(readDeclaredRepoUrl(pkg('pypi'))).resolves.toBeNull();
  });

  it('skips a non-string label value', async () => {
    readTomlMock.mockResolvedValue({ project: { urls: { Repository: 42 } } });
    await expect(readDeclaredRepoUrl(pkg('pypi'))).resolves.toBeNull();
  });

  it('returns null when pyproject.toml is unreadable', async () => {
    readTomlMock.mockResolvedValue(null);
    await expect(readDeclaredRepoUrl(pkg('pypi'))).resolves.toBeNull();
  });

  it('returns null for a manifest with no [project] table', async () => {
    readTomlMock.mockResolvedValue({ 'build-system': { 'build-backend': 'setuptools.build_meta' } });
    await expect(readDeclaredRepoUrl(pkg('pypi'))).resolves.toBeNull();
  });

  it('returns null for a [project] with no urls table', async () => {
    readTomlMock.mockResolvedValue({ project: { name: 'widget' } });
    await expect(readDeclaredRepoUrl(pkg('pypi'))).resolves.toBeNull();
  });
});
