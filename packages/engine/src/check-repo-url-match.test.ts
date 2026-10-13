import { readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkRepoUrlMatch } from './check-repo-url-match.js';
import type { Package } from './config.js';

vi.mock('node:fs/promises');

/** Virtual filesystem: normalized absolute path -> file contents. */
const vfs = new Map<string, string>();

/** Separator-normalize a path (Windows `\\` -> `/`, strip a `C:` drive). */
function norm(p: unknown): string {
  return String(p).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');
}

/** Join path segments with `/` — input construction only, never asserted. */
function j(...parts: string[]): string {
  return parts.join('/');
}

function setFile(path: string, content: string): void {
  vfs.set(norm(path), content);
}

function pkg(kind: Package['kind'], overrides: Partial<Package> = {}): Package {
  return {
    name: `${kind}-pkg`,
    kind,
    path: '.',
    globs: ['**'],
    depends_on: [],
    first_version: '0.1.0',
    ...overrides,
  } as Package;
}

beforeEach(() => {
  vi.clearAllMocks();
  vfs.clear();
  vi.mocked(readFile).mockImplementation((path: unknown) => {
    const key = norm(path);
    const found = vfs.get(key);
    if (found !== undefined) {return Promise.resolve(found);}
    const err = new Error(
      `ENOENT: no such file or directory, open '${String(path)}'`,
    ) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    return Promise.reject(err);
  });
});

describe('checkRepoUrlMatch — manifest URL must match GITHUB_REPOSITORY', () => {
  const dir = '/vfs/repo-url';

  function npmPkg(name: string, path: string): Package {
    return pkg('npm', { name, path });
  }
  function cratesPkg(name: string, path: string): Package {
    return pkg('crates', { name, path });
  }
  function pypiPkg(name: string, path: string): Package {
    return pkg('pypi', { name, path });
  }
  function writePkgJson(path: string, body: unknown): void {
    setFile(j(path, 'package.json'), JSON.stringify(body));
  }
  function writeCargoToml(path: string, body: string): void {
    setFile(j(path, 'Cargo.toml'), body);
  }
  function writePyproject(path: string, body: string): void {
    setFile(j(path, 'pyproject.toml'), body);
  }

  it('npm: passes when repository.url (object form) parses to the same owner/repo as GITHUB_REPOSITORY', async () => {
    const p = j(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: { type: 'git', url: 'git+https://github.com/acme/widget.git' },
    });
    expect(
      await checkRepoUrlMatch([npmPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
    // The npm manifest is read via readJson's readFile(path, 'utf8')
    //. This test reads only a package.json, so pinning
    // that basename's encoding kills the StringLiteral mutant on that line.
    expect(vi.mocked(readFile)).toHaveBeenCalledWith(
      expect.stringContaining('package.json'),
      'utf8',
    );
  });

  it('npm: passes when repository is the legacy non-empty string form and matches', async () => {
    const p = j(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: 'git+https://github.com/acme/widget.git',
    });
    expect(
      await checkRepoUrlMatch([npmPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
  });

  it('npm: fails when repository.url resolves to a different owner/repo (the 422 provenance bug)', async () => {
    const p = j(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: { type: 'git', url: 'git+https://github.com/thekevinscott/modwheel.git' },
    });
    const findings = await checkRepoUrlMatch([npmPkg('a', p)], {
      githubRepository: 'thekevinscott/steervec',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      package: 'a',
      declaredOwnerRepo: 'thekevinscott/modwheel',
      expectedOwnerRepo: 'thekevinscott/steervec',
    });
  });

  it('npm: fails when repository (string form) resolves to a different owner/repo', async () => {
    const p = j(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: 'git+https://github.com/wrong/repo.git',
    });
    const findings = await checkRepoUrlMatch([npmPkg('a', p)], {
      githubRepository: 'acme/widget',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.declaredOwnerRepo).toBe('wrong/repo');
  });

  it('crates: passes when [package].repository matches', async () => {
    const p = j(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version = "0.0.0"
description = "x"
license = "MIT"
repository = "https://github.com/acme/widget"
`,
    );
    expect(
      await checkRepoUrlMatch([cratesPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
    // The crates manifest is read via readTomlDoc's readFile(path, 'utf8')
    //. checkRepoUrlMatch does not use readToml, so this
    // Cargo.toml read is the only one here — pinning its encoding kills the
    // StringLiteral mutant on that line.
    expect(vi.mocked(readFile)).toHaveBeenCalledWith(
      expect.stringContaining('Cargo.toml'),
      'utf8',
    );
  });

  it('crates: fails when [package].repository resolves to a different owner/repo', async () => {
    const p = j(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version = "0.0.0"
description = "x"
license = "MIT"
repository = "https://github.com/wrong/repo"
`,
    );
    const findings = await checkRepoUrlMatch([cratesPkg('a', p)], {
      githubRepository: 'acme/widget',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      package: 'a',
      declaredOwnerRepo: 'wrong/repo',
      expectedOwnerRepo: 'acme/widget',
    });
  });

  it('pypi: passes when [project.urls].Repository matches', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[project]
name = "a"
dynamic = ["version"]
[project.urls]
Repository = "https://github.com/acme/widget"
`,
    );
    expect(
      await checkRepoUrlMatch([pypiPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
  });

  it('pypi: fails when [project.urls].Repository resolves to a different owner/repo', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[project]
name = "a"
dynamic = ["version"]
[project.urls]
Repository = "https://github.com/wrong/repo"
`,
    );
    const findings = await checkRepoUrlMatch([pypiPkg('a', p)], {
      githubRepository: 'acme/widget',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.declaredOwnerRepo).toBe('wrong/repo');
  });

  it('skips packages whose manifest does not declare a repository field (other checks own that)', async () => {
    const p = j(dir, 'a');
    writePkgJson(p, { name: 'a', version: '0.0.0' });
    expect(
      await checkRepoUrlMatch([npmPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
  });

  it('skips crates packages whose Cargo.toml declares no [package].repository field', async () => {
    const p = j(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version = "0.0.0"
description = "x"
license = "MIT"
`,
    );
    expect(
      await checkRepoUrlMatch([cratesPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
  });

  it('skips pypi packages whose pyproject.toml has no [project.urls] block', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[project]
name = "a"
dynamic = ["version"]
`,
    );
    expect(
      await checkRepoUrlMatch([pypiPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
  });

  it('skips a missing or unreadable manifest (other checks own that diagnostic)', async () => {
    const missing = j(dir, 'missing');
    expect(
      await checkRepoUrlMatch(
        [
          npmPkg('a', missing),
          cratesPkg('b', missing),
          pypiPkg('c', missing),
        ],
        { githubRepository: 'acme/widget' },
      ),
    ).toEqual([]);
  });

  it('skips a malformed package.json / Cargo.toml / pyproject.toml (build tooling surfaces those)', async () => {
    const npmDir = j(dir, 'npm');
    const cratesDir = j(dir, 'crates');
    const pypiDir = j(dir, 'pypi');
    setFile(j(npmDir, 'package.json'), '{ not json');
    setFile(j(cratesDir, 'Cargo.toml'), '[broken\nnope');
    setFile(j(pypiDir, 'pyproject.toml'), '[broken\nnope');
    expect(
      await checkRepoUrlMatch(
        [
          npmPkg('a', npmDir),
          cratesPkg('b', cratesDir),
          pypiPkg('c', pypiDir),
        ],
        { githubRepository: 'acme/widget' },
      ),
    ).toEqual([]);
  });

  it('falls back to other [project.urls] keys when Repository is absent (Source / Homepage)', async () => {
    const a = j(dir, 'a');
    const b = j(dir, 'b');
    writePyproject(
      a,
      `[project]
name = "a"
dynamic = ["version"]
[project.urls]
Source = "https://github.com/acme/widget"
`,
    );
    writePyproject(
      b,
      `[project]
name = "b"
dynamic = ["version"]
[project.urls]
Homepage = "https://github.com/wrong/repo"
`,
    );
    expect(
      (await checkRepoUrlMatch(
        [pypiPkg('a', a), pypiPkg('b', b)],
        { githubRepository: 'acme/widget' },
      )).map((f) => f.package),
    ).toEqual(['b']);
  });

  it('accepts an already-normalised GITHUB_REPOSITORY value in URL form', async () => {
    // Defensive: the GHA env var is documented as `owner/repo`, but a
    // consumer who exports a full URL to the same env name shouldn't
    // false-positive against a manifest that already agrees.
    const p = j(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: 'git+https://github.com/acme/widget.git',
    });
    expect(
      await checkRepoUrlMatch([npmPkg('a', p)], {
        githubRepository: 'https://github.com/acme/widget',
      }),
    ).toEqual([]);
  });

  it('skips manifests pointing at non-github hosts (provenance catches those at publish time)', async () => {
    const p = j(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: 'https://gitlab.com/acme/widget.git',
    });
    expect(
      await checkRepoUrlMatch([npmPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
  });

  it('skips the check entirely when githubRepository is undefined (local CLI run, no GHA context)', async () => {
    const p = j(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: 'git+https://github.com/wrong/repo.git',
    });
    expect(await checkRepoUrlMatch([npmPkg('a', p)], {})).toEqual([]);
    expect(await checkRepoUrlMatch([npmPkg('a', p)], { githubRepository: '' })).toEqual([]);
  });

  it('parses the ssh URL form (git@github.com:owner/repo.git) to owner/repo', async () => {
    const p = j(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: { type: 'git', url: 'git@github.com:acme/widget.git' },
    });
    expect(
      await checkRepoUrlMatch([npmPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
  });

  it('parses plain https URLs without the .git suffix or with a trailing slash', async () => {
    const a = j(dir, 'a');
    const b = j(dir, 'b');
    writePkgJson(a, {
      name: 'a',
      version: '0.0.0',
      repository: { type: 'git', url: 'https://github.com/acme/widget' },
    });
    writePkgJson(b, {
      name: 'b',
      version: '0.0.0',
      repository: { type: 'git', url: 'https://github.com/acme/widget/' },
    });
    expect(
      await checkRepoUrlMatch(
        [npmPkg('a', a), npmPkg('b', b)],
        { githubRepository: 'acme/widget' },
      ),
    ).toEqual([]);
  });

  it('reports every failing package, not just the first', async () => {
    const a = j(dir, 'a');
    const b = j(dir, 'b');
    writePkgJson(a, {
      name: 'a',
      version: '0.0.0',
      repository: 'git+https://github.com/wrong/a.git',
    });
    writePkgJson(b, {
      name: 'b',
      version: '0.0.0',
      repository: 'git+https://github.com/wrong/b.git',
    });
    const findings = await checkRepoUrlMatch(
      [npmPkg('a', a), npmPkg('b', b)],
      { githubRepository: 'acme/widget' },
    );
    expect(findings.map((f) => f.package).sort()).toEqual(['a', 'b']);
  });

});
