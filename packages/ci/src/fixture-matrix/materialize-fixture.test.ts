/**
 * Wiring test for the fixture-matrix materializer (#670): mocks the OS
 * boundary (`node:fs/promises`, the exec seam) and lets the real
 * `applySubstitutions` run, so the manifest rewrite and git sequence are
 * pinned end to end.
 */

import { cp, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execInherit } from '../utils/exec-inherit.js';
import { materializeFixtureForMatrix } from './materialize-fixture.js';

vi.mock('node:fs/promises');
vi.mock('../utils/exec-inherit.js');

const mkdtempMock = vi.mocked(mkdtemp);
const cpMock = vi.mocked(cp);
const readdirMock = vi.mocked(readdir);
const readFileMock = vi.mocked(readFile);
const writeFileMock = vi.mocked(writeFile);
const execMock = vi.mocked(execInherit);

type Dirents = Awaited<ReturnType<typeof readdir>>;

function dirent(name: string, parentPath: string, file = true): { name: string; parentPath: string; isFile: () => boolean } {
  return { name, parentPath, isFile: () => file };
}

const TMP_DIR = '/tmp/piot-fixture-matrix-abc123';

beforeEach(() => {
  vi.resetAllMocks();
  mkdtempMock.mockResolvedValue(TMP_DIR);
  readdirMock.mockResolvedValue([]);
  readFileMock.mockResolvedValue('');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('materializeFixtureForMatrix', () => {
  it('copies the fixture into a fresh temp dir under the OS tmp root', async () => {
    const dir = await materializeFixtureForMatrix('/repo/packages/engine/tests/fixtures', 'js-vanilla');
    expect(dir).toBe(TMP_DIR);
    expect(cpMock).toHaveBeenCalledWith('/repo/packages/engine/tests/fixtures/js-vanilla', TMP_DIR, {
      recursive: true,
    });
  });

  it('rewrites __VERSION__ in every manifest basename, leaving other tokens untouched', async () => {
    readFileMock.mockResolvedValue('name = "pkg-placeholder"\nversion = "__VERSION__"\n');
    readdirMock.mockResolvedValue([
      dirent('putitoutthere.toml', TMP_DIR),
      dirent('README.md', TMP_DIR),
      dirent('Cargo.toml', `${TMP_DIR}/crate`),
    ] as unknown as Dirents);

    await materializeFixtureForMatrix('/repo/packages/engine/tests/fixtures', 'rust-vanilla-first-publish');

    expect(writeFileMock).toHaveBeenCalledTimes(2);
    expect(writeFileMock).toHaveBeenNthCalledWith(
      1,
      `${TMP_DIR}/putitoutthere.toml`,
      'name = "pkg-placeholder"\nversion = "0.0.0"\n',
    );
    expect(writeFileMock).toHaveBeenNthCalledWith(
      2,
      `${TMP_DIR}/crate/Cargo.toml`,
      'name = "pkg-placeholder"\nversion = "0.0.0"\n',
    );
  });

  it('leaves the -placeholder suffix untouched, unlike fixture-materialize plan mode', async () => {
    readFileMock.mockResolvedValue('name = "pkg-placeholder"');
    readdirMock.mockResolvedValue([dirent('package.json', TMP_DIR)] as unknown as Dirents);

    await materializeFixtureForMatrix('/repo/packages/engine/tests/fixtures', 'js-napi-first-publish');

    expect(writeFileMock).toHaveBeenCalledWith(`${TMP_DIR}/package.json`, 'name = "pkg-placeholder"');
  });

  it('runs the exact git init + commit sequence in the materialized dir', async () => {
    await materializeFixtureForMatrix('/repo/packages/engine/tests/fixtures', 'js-vanilla');
    const GIT_SEQUENCE: readonly string[][] = [
      ['init', '-q', '-b', 'main'],
      ['config', 'user.email', 'e2e@putitoutthere.dev'],
      ['config', 'user.name', 'piot e2e'],
      ['config', 'commit.gpgsign', 'false'],
      ['config', 'tag.gpgsign', 'false'],
      ['add', '.'],
      ['commit', '-q', '-m', 'e2e: initial fixture'],
    ];
    expect(execMock).toHaveBeenCalledTimes(GIT_SEQUENCE.length);
    GIT_SEQUENCE.forEach((args, i) => {
      expect(execMock).toHaveBeenNthCalledWith(i + 1, 'git', args, { cwd: TMP_DIR });
    });
  });
});
