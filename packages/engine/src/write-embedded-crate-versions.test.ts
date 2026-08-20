/**
 * Unit tests for `writeEmbeddedCrateVersions` (#621).
 *
 * `node:fs` and the workspace-root walk are mocked so each case isolates a
 * routing branch; the real on-disk graph walk is covered by the integration
 * tier and the compiled-artifact contract by the e2e tier.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findWorkspaceRoot } from './find-workspace-root.js';
import { writeEmbeddedCrateVersions } from './write-embedded-crate-versions.js';

vi.mock('node:fs/promises');
vi.mock('./find-workspace-root.js');

const readFileMock = vi.mocked(readFile);
const writeMock = vi.mocked(writeFile);
const findRootMock = vi.mocked(findWorkspaceRoot);

/** Serve each manifest by the directory it lives in. */
function manifests(byDir: Record<string, string>): void {
  readFileMock.mockImplementation((p) => {
    const path = p as string;
    for (const [dir, body] of Object.entries(byDir)) {
      if (path === `${dir}/Cargo.toml`) {return Promise.resolve(body);}
    }
    return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });
}

const written = (): string[] => writeMock.mock.calls.map((c) => c[0] as string);
const contentsFor = (path: string): string =>
  (writeMock.mock.calls.find((c) => c[0] === path)?.[1] as string) ?? '';

beforeEach(() => {
  vi.resetAllMocks();
  findRootMock.mockResolvedValue(null);
});

describe('writeEmbeddedCrateVersions', () => {
  it('bumps a crate reached through a path dependency', async () => {
    manifests({
      '/r/host': '[package]\nname = "host"\nversion = "0.2.7"\n\n[dependencies]\ncore = { path = "../core" }\n',
      '/r/core': '[package]\nname = "core"\nversion = "0.2.7"\n',
    });
    const out = await writeEmbeddedCrateVersions('/r/host', '0.4.2');

    expect(out).toContain('/r/core/Cargo.toml');
    expect(contentsFor('/r/core/Cargo.toml')).toContain('version = "0.4.2"');
  });

  it('rewrites the requirement pointing at the bumped crate', async () => {
    manifests({
      '/r/host':
        '[package]\nname = "host"\nversion = "0.2.7"\n\n[dependencies]\ncore = { path = "../core", version = "0.2" }\n',
      '/r/core': '[package]\nname = "core"\nversion = "0.2.7"\n',
    });
    await writeEmbeddedCrateVersions('/r/host', '0.4.2');

    // Left behind, `^0.2` stops matching 0.4.2 and cargo refuses to resolve.
    expect(contentsFor('/r/host/Cargo.toml')).toContain('version = "0.4.2"');
  });

  it('follows the graph transitively', async () => {
    manifests({
      '/r/host': '[package]\nname = "host"\nversion = "0.2.7"\n\n[dependencies]\nmid = { path = "../mid" }\n',
      '/r/mid': '[package]\nname = "mid"\nversion = "0.2.7"\n\n[dependencies]\ncore = { path = "../core" }\n',
      '/r/core': '[package]\nname = "core"\nversion = "0.2.7"\n',
    });
    const out = await writeEmbeddedCrateVersions('/r/host', '0.4.2');

    expect(out).toEqual(expect.arrayContaining(['/r/mid/Cargo.toml', '/r/core/Cargo.toml']));
  });

  it('terminates on a dependency cycle', async () => {
    manifests({
      '/r/host': '[package]\nname = "host"\nversion = "0.2.7"\n\n[dependencies]\na = { path = "../a" }\n',
      '/r/a': '[package]\nname = "a"\nversion = "0.2.7"\n\n[dependencies]\nhost = { path = "../host" }\n',
    });
    // A dev-dependency cycle between two crates is legal in cargo; an
    // unguarded walk would spin forever.
    await expect(writeEmbeddedCrateVersions('/r/host', '0.4.2')).resolves.toBeDefined();
  });

  it('does not bump the crate it started from', async () => {
    // The caller's own writer already handled it; double-writing would
    // report a path twice and muddy the "what did we change" list.
    manifests({ '/r/host': '[package]\nname = "host"\nversion = "0.2.7"\n' });
    const out = await writeEmbeddedCrateVersions('/r/host', '0.4.2');
    expect(out).toEqual([]);
  });

  it('skips a virtual manifest that declares no package', async () => {
    manifests({
      '/r/host': '[package]\nname = "host"\nversion = "0.2.7"\n\n[dependencies]\nc = { path = "../virt" }\n',
      '/r/virt': '[workspace]\nmembers = ["x"]\n',
    });
    // No `[package]` table means there is no crate version to write.
    await writeEmbeddedCrateVersions('/r/host', '0.4.2');
    expect(written()).not.toContain('/r/virt/Cargo.toml');
  });

  it('tolerates a missing manifest', async () => {
    manifests({
      '/r/host': '[package]\nname = "host"\nversion = "0.2.7"\n\n[dependencies]\ngone = { path = "../gone" }\n',
    });
    await expect(writeEmbeddedCrateVersions('/r/host', '0.4.2')).resolves.toEqual([]);
  });

  it('tolerates an unparseable manifest', async () => {
    manifests({
      '/r/host': '[package]\nname = "host"\nversion = "0.2.7"\n\n[dependencies]\nbad = { path = "../bad" }\n',
      '/r/bad': 'this is not = = valid toml [[[',
    });
    await expect(writeEmbeddedCrateVersions('/r/host', '0.4.2')).resolves.toEqual([]);
  });

  it('rewrites an inherited requirement in the workspace root', async () => {
    findRootMock.mockResolvedValue('/r');
    manifests({
      '/r': '[workspace]\nmembers = ["host", "core"]\n\n[workspace.dependencies]\ncore = { path = "core", version = "0.2" }\n',
      '/r/host': '[package]\nname = "host"\nversion = "0.2.7"\n\n[dependencies]\ncore.workspace = true\n',
      '/r/core': '[package]\nname = "core"\nversion = "0.2.7"\n',
    });
    await writeEmbeddedCrateVersions('/r/host', '0.4.2');

    // The member declares no `version` key -- the requirement lives in the
    // root, a file no member's own rewrite would touch.
    expect(contentsFor('/r/Cargo.toml')).toContain('version = "0.4.2"');
  });

  it('treats a non-string workspace root as no workspace', async () => {
    findRootMock.mockResolvedValue(undefined as unknown as null);
    manifests({ '/r/host': '[package]\nname = "host"\nversion = "0.2.7"\n' });
    await expect(writeEmbeddedCrateVersions('/r/host', '0.4.2')).resolves.toEqual([]);
  });

  it('leaves a registry dependency requirement untouched', async () => {
    manifests({
      '/r/host':
        '[package]\nname = "host"\nversion = "0.2.7"\n\n[dependencies]\ncore = { path = "../core" }\n\n[dependencies.pyo3]\nversion = "0.22"\n',
      '/r/core': '[package]\nname = "core"\nversion = "0.2.7"\n',
    });
    await writeEmbeddedCrateVersions('/r/host', '0.4.2');
    const host = contentsFor('/r/host/Cargo.toml');
    // Either untouched entirely, or rewritten without disturbing pyo3.
    if (host !== '') {expect(host).toContain('version = "0.22"');}
  });
});
