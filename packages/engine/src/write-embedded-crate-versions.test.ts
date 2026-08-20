/**
 * Unit tests for `writeEmbeddedCrateVersions` (#621).
 *
 * `node:fs` and the workspace-root walk are mocked so each case isolates a
 * routing branch; the real on-disk graph walk is covered by the integration
 * tier and the compiled-artifact contract by the e2e tier.
 *
 * Manifests are matched by path SUFFIX rather than equality: the unit
 * suite also runs on windows-latest, where the code under test resolves
 * "/r/host" into a drive-lettered, backslash-separated path. Comparing the
 * tail keeps the assertions honest on both without importing a path
 * collaborator the isolation gate would reject.
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

const ROOT = '/r';
const HOST = '/r/host';
const CORE = '/r/core';
const MID = '/r/mid';
const A = '/r/a';
const VIRT = '/r/virt';
const BAD = '/r/bad';
const OTHER = '/r/other';

/** True when `path` is the Cargo.toml of `dir`, on any platform. */
const isManifestIn = (path: string, dir: string): boolean =>
  path.replace(/\\/g, '/').endsWith(`${dir}/Cargo.toml`);

const pkg = (name: string, body = ''): string =>
  `[package]\nname = "${name}"\nversion = "0.2.7"\n${body}`;

/** Serve each manifest by the directory it lives in. */
function manifests(byDir: Record<string, string>): void {
  readFileMock.mockImplementation((p) => {
    const path = p as string;
    for (const [dir, body] of Object.entries(byDir)) {
      if (isManifestIn(path, dir)) {return Promise.resolve(body);}
    }
    return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });
}

/** Did any write land on `dir`'s manifest? */
const wrote = (dir: string): boolean =>
  writeMock.mock.calls.some((c) => isManifestIn(c[0] as string, dir));
const contentsFor = (dir: string): string =>
  (writeMock.mock.calls.find((c) => isManifestIn(c[0] as string, dir))?.[1] as string) ?? '';
/** Did the returned path list report `dir`'s manifest? */
const reported = (out: readonly string[], dir: string): boolean =>
  out.some((p) => isManifestIn(p, dir));

beforeEach(() => {
  vi.resetAllMocks();
  findRootMock.mockResolvedValue(null);
});

describe('writeEmbeddedCrateVersions', () => {
  it('bumps a crate reached through a path dependency', async () => {
    manifests({
      [HOST]: pkg('host', '\n[dependencies]\ncore = { path = "../core" }\n'),
      [CORE]: pkg('core'),
    });
    const out = await writeEmbeddedCrateVersions(HOST, '0.4.2');

    expect(reported(out, CORE)).toBe(true);
    expect(contentsFor(CORE)).toContain('version = "0.4.2"');
  });

  it('rewrites the requirement pointing at the bumped crate', async () => {
    manifests({
      [HOST]: pkg('host', '\n[dependencies]\ncore = { path = "../core", version = "0.2" }\n'),
      [CORE]: pkg('core'),
    });
    await writeEmbeddedCrateVersions(HOST, '0.4.2');

    // Left behind, `^0.2` stops matching 0.4.2 and cargo refuses to resolve.
    expect(contentsFor(HOST)).toContain('version = "0.4.2"');
  });

  it('does NOT rewrite a requirement pointing at a crate this run never bumped', async () => {
    findRootMock.mockResolvedValue(ROOT);
    manifests({
      [ROOT]:
        '[workspace]\nmembers = ["host", "core", "other"]\n\n[workspace.dependencies]\n' +
        'core = { path = "core", version = "0.2" }\n' +
        'other = { path = "other", version = "0.7" }\n',
      [HOST]: pkg('host', '\n[dependencies]\ncore.workspace = true\n'),
      [CORE]: pkg('core'),
      [OTHER]: pkg('other'),
    });
    await writeEmbeddedCrateVersions(HOST, '0.4.2');

    const root = contentsFor(ROOT);
    // `other` is a workspace member the artifact never compiles. Pinning it
    // to the release version would name a version nothing produced.
    expect(root).toContain('core = { path = "core", version = "0.4.2" }');
    expect(root).toContain('other = { path = "other", version = "0.7" }');
    expect(wrote(OTHER)).toBe(false);
  });

  it('follows the graph transitively', async () => {
    manifests({
      [HOST]: pkg('host', '\n[dependencies]\nmid = { path = "../mid" }\n'),
      [MID]: pkg('mid', '\n[dependencies]\ncore = { path = "../core" }\n'),
      [CORE]: pkg('core'),
    });
    const out = await writeEmbeddedCrateVersions(HOST, '0.4.2');

    expect(reported(out, MID)).toBe(true);
    expect(reported(out, CORE)).toBe(true);
  });

  it('terminates on a dependency cycle without bumping the starting crate', async () => {
    manifests({
      [HOST]: pkg('host', '\n[dependencies]\na = { path = "../a" }\n'),
      [A]: pkg('a', '\n[dependencies]\nhost = { path = "../host" }\n'),
    });
    const out = await writeEmbeddedCrateVersions(HOST, '0.4.2');

    // The cycle points back at the start. Its own writer already bumped it,
    // so re-reporting it here would double-count the change.
    expect(reported(out, A)).toBe(true);
    expect(reported(out, HOST)).toBe(false);
  });

  it('does not bump the crate it started from', async () => {
    manifests({ [HOST]: pkg('host') });
    expect(await writeEmbeddedCrateVersions(HOST, '0.4.2')).toEqual([]);
  });

  it('skips a virtual manifest that declares no package', async () => {
    manifests({
      [HOST]: pkg('host', '\n[dependencies]\nc = { path = "../virt" }\n'),
      [VIRT]: '[workspace]\nmembers = ["x"]\n',
    });
    // No `[package]` table means there is no crate version to write.
    await writeEmbeddedCrateVersions(HOST, '0.4.2');
    expect(wrote(VIRT)).toBe(false);
  });

  it('tolerates a missing manifest and writes nothing for it', async () => {
    manifests({ [HOST]: pkg('host', '\n[dependencies]\ngone = { path = "../gone" }\n') });
    expect(await writeEmbeddedCrateVersions(HOST, '0.4.2')).toEqual([]);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('tolerates an unparseable manifest and writes nothing for it', async () => {
    manifests({
      [HOST]: pkg('host', '\n[dependencies]\nbad = { path = "../bad" }\n'),
      [BAD]: 'this is not = = valid toml [[[',
    });
    expect(await writeEmbeddedCrateVersions(HOST, '0.4.2')).toEqual([]);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('propagates a read failure that is not ENOENT', async () => {
    // A missing file is an ordinary outcome; a permissions error is not, and
    // swallowing it would silently ship an under-versioned artifact.
    readFileMock.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    await expect(writeEmbeddedCrateVersions(HOST, '0.4.2')).rejects.toThrow('denied');
  });

  it('reads and writes manifests as utf8 text', async () => {
    manifests({
      [HOST]: pkg('host', '\n[dependencies]\ncore = { path = "../core", version = "0.2" }\n'),
      [CORE]: pkg('core'),
    });
    await writeEmbeddedCrateVersions(HOST, '0.4.2');

    expect(readFileMock).toHaveBeenCalledWith(expect.stringContaining('Cargo.toml'), 'utf8');
    // Assert on the requirement-rewrite call specifically. A blanket
    // `toHaveBeenCalledWith` would be satisfied by the separate crate-version
    // write, letting an encoding regression here pass unnoticed.
    const hostWrite = writeMock.mock.calls.find((c) => isManifestIn(c[0] as string, HOST));
    expect(hostWrite?.[2]).toBe('utf8');
  });

  it('rewrites an inherited requirement in the workspace root', async () => {
    findRootMock.mockResolvedValue(ROOT);
    manifests({
      [ROOT]:
        '[workspace]\nmembers = ["host", "core"]\n\n[workspace.dependencies]\ncore = { path = "core", version = "0.2" }\n',
      [HOST]: pkg('host', '\n[dependencies]\ncore.workspace = true\n'),
      [CORE]: pkg('core'),
    });
    await writeEmbeddedCrateVersions(HOST, '0.4.2');

    // The member declares no `version` key -- the requirement lives in the
    // root, a file no member's own rewrite would touch.
    expect(contentsFor(ROOT)).toContain('version = "0.4.2"');
  });

  it('still bumps embedded crates when the workspace root manifest is unreadable', async () => {
    findRootMock.mockResolvedValue(ROOT);
    // Root reported but absent: inherited entries cannot resolve, yet a
    // direct path dependency must still be bumped.
    manifests({
      [HOST]: pkg('host', '\n[dependencies]\ncore = { path = "../core" }\n'),
      [CORE]: pkg('core'),
    });
    const out = await writeEmbeddedCrateVersions(HOST, '0.4.2');
    expect(reported(out, CORE)).toBe(true);
  });

  it('treats a non-string workspace root as no workspace', async () => {
    findRootMock.mockResolvedValue(undefined as unknown as null);
    manifests({ [HOST]: pkg('host') });
    expect(await writeEmbeddedCrateVersions(HOST, '0.4.2')).toEqual([]);
  });

  it('leaves a registry dependency requirement untouched', async () => {
    manifests({
      [HOST]: pkg(
        'host',
        '\n[dependencies]\ncore = { path = "../core", version = "0.2" }\n\n[dependencies.pyo3]\nversion = "0.22"\n',
      ),
      [CORE]: pkg('core'),
    });
    await writeEmbeddedCrateVersions(HOST, '0.4.2');
    expect(contentsFor(HOST)).toContain('version = "0.22"');
  });
});
