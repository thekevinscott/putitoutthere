/**
 * Unit tests for `writeDependentVersionReqs` (#640).
 *
 * `node:fs` and the workspace-root walk are mocked so each case isolates one
 * routing branch; the real on-disk walk is covered by the integration tier
 * and cargo's own verdict on the result by the e2e tier.
 *
 * Manifests are matched by path SUFFIX rather than equality: the unit suite
 * also runs on windows-latest, where the code under test resolves "/r/host"
 * into a drive-lettered, backslash-separated path. Comparing the tail keeps
 * the assertions honest on both. Workspace members are spelled literally so
 * the real `expandDirGlob` resolves them without touching the filesystem.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findWorkspaceRoot } from './find-workspace-root.js';
import { writeDependentVersionReqs } from './write-dependent-version-reqs.js';

vi.mock('node:fs/promises');
vi.mock('./find-workspace-root.js');

const readFileMock = vi.mocked(readFile);
const writeMock = vi.mocked(writeFile);
const findRootMock = vi.mocked(findWorkspaceRoot);

const ROOT = '/r';
const CORE = '/r/core';
const HOST = '/r/host';
const OTHER = '/r/other';

/** True when `path` is the Cargo.toml of `dir`, on any platform. */
const isManifestIn = (path: string, dir: string): boolean =>
  path.replace(/\\/g, '/').endsWith(`${dir}/Cargo.toml`);

/** Serve each manifest by the directory it lives in; ENOENT otherwise. */
function manifests(byDir: Record<string, string>): void {
  readFileMock.mockImplementation((p) => {
    const path = p as string;
    for (const [dir, body] of Object.entries(byDir)) {
      if (isManifestIn(path, dir)) {return Promise.resolve(body);}
    }
    return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });
}

const workspace = (members: string[], extra = ''): string =>
  `[workspace]\nmembers = [${members.map((m) => `"${m}"`).join(', ')}]\nresolver = "2"\n${extra}`;

/** What was written to `dir`'s Cargo.toml, or undefined if it was untouched. */
function writtenTo(dir: string): string | undefined {
  const call = writeMock.mock.calls.find(([p]) => isManifestIn(p as string, dir));
  return call?.[1] as string | undefined;
}

beforeEach(() => {
  vi.resetAllMocks();
  findRootMock.mockResolvedValue(ROOT);
});

describe('writeDependentVersionReqs', () => {
  it('moves an inline-table requirement in a workspace member', async () => {
    manifests({
      [ROOT]: workspace(['core', 'host']),
      [CORE]: '[package]\nname = "core"\nversion = "0.4.2"\n',
      [HOST]: '[package]\nname = "host"\n\n[dependencies]\ncore = { path = "../core", version = "0.2" }\n',
    });
    const written = await writeDependentVersionReqs(CORE, '0.4.2');
    expect(writtenTo(HOST)).toContain('version = "0.4.2"');
    expect(written).toHaveLength(1);
  });

  it('moves a section-table requirement', async () => {
    manifests({
      [ROOT]: workspace(['core', 'host']),
      [CORE]: '[package]\nname = "core"\n',
      [HOST]: '[package]\nname = "host"\n\n[dependencies.core]\npath = "../core"\nversion = "0.2"\n',
    });
    await writeDependentVersionReqs(CORE, '0.4.2');
    expect(writtenTo(HOST)).toContain('version = "0.4.2"');
  });

  it('moves a requirement declared in [workspace.dependencies]', async () => {
    // Where an inheriting member's requirement actually lives — a file no
    // member's own rewrite would ever touch.
    manifests({
      [ROOT]: workspace(['core', 'host'], '\n[workspace.dependencies]\ncore = { path = "core", version = "0.2" }\n'),
      [CORE]: '[package]\nname = "core"\n',
      [HOST]: '[package]\nname = "host"\n\n[dependencies]\ncore.workspace = true\n',
    });
    await writeDependentVersionReqs(CORE, '0.4.2');
    expect(writtenTo(ROOT)).toContain('version = "0.4.2"');
    expect(writtenTo(HOST)).toBeUndefined();
  });

  it('leaves a registry dependency alone', async () => {
    // Pinning pyo3 to this release's version would name a pyo3 that does
    // not exist.
    manifests({
      [ROOT]: workspace(['core', 'host']),
      [CORE]: '[package]\nname = "core"\n',
      [HOST]: '[package]\nname = "host"\n\n[dependencies]\npyo3 = { version = "0.22" }\n',
    });
    expect(await writeDependentVersionReqs(CORE, '0.4.2')).toEqual([]);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('leaves a path dependency pointing at a different crate alone', async () => {
    manifests({
      [ROOT]: workspace(['core', 'host', 'other']),
      [CORE]: '[package]\nname = "core"\n',
      [OTHER]: '[package]\nname = "other"\n',
      [HOST]: '[package]\nname = "host"\n\n[dependencies]\nother = { path = "../other", version = "0.2" }\n',
    });
    expect(await writeDependentVersionReqs(CORE, '0.4.2')).toEqual([]);
  });

  it('leaves a path dependency that declares no version requirement alone', async () => {
    // Nothing to move: cargo resolves it purely by path, and inventing a
    // requirement would change what the manifest means.
    manifests({
      [ROOT]: workspace(['core', 'host']),
      [CORE]: '[package]\nname = "core"\n',
      [HOST]: '[package]\nname = "host"\n\n[dependencies]\ncore = { path = "../core" }\n',
    });
    expect(await writeDependentVersionReqs(CORE, '0.4.2')).toEqual([]);
  });

  it('never rewrites the released crate\'s own manifest', async () => {
    // A crate cannot depend on itself; reaching its manifest here would mean
    // the walk is treating the release target as one of its own dependents.
    manifests({
      [ROOT]: workspace(['core']),
      [CORE]: '[package]\nname = "core"\nversion = "0.4.2"\n',
    });
    await writeDependentVersionReqs(CORE, '0.4.2');
    expect(writtenTo(CORE)).toBeUndefined();
  });

  it('scans declared sibling packages that sit outside the workspace', async () => {
    // Two crates.io packages need not share a cargo workspace; the declared
    // package list is the other source of candidates.
    findRootMock.mockResolvedValue(null);
    manifests({
      [CORE]: '[package]\nname = "core"\n',
      [OTHER]: '[package]\nname = "other"\n\n[dependencies]\ncore = { path = "../core", version = "0.2" }\n',
    });
    await writeDependentVersionReqs(CORE, '0.4.2', [OTHER]);
    expect(writtenTo(OTHER)).toContain('version = "0.4.2"');
  });

  it('skips a candidate directory that holds no Cargo.toml', async () => {
    // A declared package directory need not be a crate at all.
    manifests({
      [ROOT]: workspace(['core']),
      [CORE]: '[package]\nname = "core"\n',
    });
    expect(await writeDependentVersionReqs(CORE, '0.4.2', ['/r/not-a-crate'])).toEqual([]);
  });

  it('skips an unparseable manifest rather than aborting the release', async () => {
    manifests({
      [ROOT]: workspace(['core', 'host']),
      [CORE]: '[package]\nname = "core"\n',
      [HOST]: 'this is not = = toml [[[',
    });
    expect(await writeDependentVersionReqs(CORE, '0.4.2')).toEqual([]);
  });

  it('surfaces a non-ENOENT read failure rather than silently skipping', async () => {
    // A permissions error is not "this directory is not a crate"; swallowing
    // it would ship a tree with a requirement left behind.
    readFileMock.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    await expect(writeDependentVersionReqs(CORE, '0.4.2')).rejects.toThrow(/EACCES/);
  });
});
