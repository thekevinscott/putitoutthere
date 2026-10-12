import { chmod, cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { Ctx } from '../types.js';
import {
  pickMainFile,
  platformArtifactName,
  targetToOsCpu,
  type NpmBuildEntry,
  type PlatformPkg,
} from './npm-platform.js';
import { synthesizePlatformPackage } from './synthesize-platform-package.js';

vi.mock('node:fs/promises');
vi.mock('node:os');
vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));
vi.mock('./npm-platform.js');

const STAGING = '/tmp/putitoutthere-plat-abc';
const ARTIFACT_DIR = join('/repo', 'artifacts', 'widget-linux-x64-gnu');

const mkdtempMock = vi.mocked(mkdtemp);
const readdirMock = vi.mocked(readdir) as unknown as MockInstance<(dir: string) => Promise<string[]>>;
const readFileMock = vi.mocked(readFile);
const writeFileMock = vi.mocked(writeFile);
const cpMock = vi.mocked(cp);
const chmodMock = vi.mocked(chmod);
const artifactNameMock = vi.mocked(platformArtifactName);
const osCpuMock = vi.mocked(targetToOsCpu);
const pickMainMock = vi.mocked(pickMainFile);

function makeCtx(over: Partial<Ctx> = {}): Ctx {
  return {
    cwd: '/repo',
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    env: {},
    artifacts: { get: () => '', has: () => false },
    ...over,
  };
}

const pkg: PlatformPkg = {
  name: 'widget',
  path: '/repo/pkg',
  build: [{ mode: 'napi', name: '{name}-{triple}' }],
  targets: ['linux-x64-gnu'],
};

const napi: NpmBuildEntry = { mode: 'napi', name: '{name}-{triple}' };
const cli: NpmBuildEntry = { mode: 'bundled-cli', name: '{name}-{triple}' };

function synth(entry: NpmBuildEntry = napi, ctx: Ctx = makeCtx(), target = 'linux-x64-gnu', isMulti = false): Promise<string> {
  return synthesizePlatformPackage(pkg, entry, target, 'widget-linux-x64-gnu', '1.2.3', ctx, isMulti);
}

function writtenJson(): Record<string, unknown> {
  const [path, body, encoding] = writeFileMock.mock.calls[0]!;
  expect(path).toBe(join(STAGING, 'package.json'));
  expect(encoding).toBe('utf8');
  expect((body as string).endsWith('}\n')).toBe(true);
  return JSON.parse(body as string) as Record<string, unknown>;
}

beforeEach(() => {
  vi.mocked(tmpdir).mockReturnValue('/tmp');
  mkdtempMock.mockResolvedValue(STAGING);
  readdirMock.mockImplementation((dir: string) =>
    Promise.resolve(dir === STAGING ? ['widget.node', 'README.md'] : ['widget.node']),
  );
  readFileMock.mockResolvedValue(JSON.stringify({ name: 'widget' }));
  artifactNameMock.mockReturnValue('widget-linux-x64-gnu');
  osCpuMock.mockReturnValue({ os: ['linux'], cpu: ['x64'], libc: ['glibc'] });
  pickMainMock.mockResolvedValue('widget.node');
});

describe('synthesizePlatformPackage', () => {
  it('stages the artifact into a fresh tempdir and returns that directory', async () => {
    await expect(synth()).resolves.toBe(STAGING);
    expect(mkdtempMock).toHaveBeenCalledWith(join('/tmp', 'putitoutthere-plat-'));
    expect(artifactNameMock).toHaveBeenCalledWith('widget', 'napi', 'linux-x64-gnu', false);
    expect(readdirMock).toHaveBeenCalledWith(ARTIFACT_DIR);
    expect(cpMock).toHaveBeenCalledWith(join(ARTIFACT_DIR, 'widget.node'), join(STAGING, 'widget.node'), { recursive: true });
  });

  it('passes the multi-mode flag through to the artifact name', async () => {
    await synth(cli, makeCtx(), 'linux-x64-gnu', true);
    expect(artifactNameMock).toHaveBeenCalledWith('widget', 'bundled-cli', 'linux-x64-gnu', true);
  });

  it('reads artifacts from ctx.artifactsRoot when set', async () => {
    await synth(napi, makeCtx({ artifactsRoot: '/elsewhere' }));
    expect(readdirMock).toHaveBeenCalledWith(join('/elsewhere', 'widget-linux-x64-gnu'));
  });

  it('throws on an empty artifact directory before writing anything', async () => {
    readdirMock.mockResolvedValue([]);
    await expect(synth()).rejects.toThrow(`platform artifact empty: ${ARTIFACT_DIR}`);
    expect(cpMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('writes a platform package.json from the staged files, the triple, and the main package', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({
      name: 'widget',
      repository: { type: 'git', url: 'https://github.com/acme/widget' },
      license: 'MIT',
      homepage: 'https://acme.dev',
      description: 'not inherited',
    }));
    await synth();
    expect(readFileMock).toHaveBeenCalledWith(join('/repo/pkg', 'package.json'), 'utf8');
    expect(pickMainMock).toHaveBeenCalledWith(STAGING, ['widget.node', 'README.md'], 'napi');
    expect(osCpuMock).toHaveBeenCalledWith('linux-x64-gnu');
    expect(writtenJson()).toEqual({
      name: 'widget-linux-x64-gnu',
      version: '1.2.3',
      os: ['linux'],
      cpu: ['x64'],
      files: ['widget.node', 'README.md'],
      main: 'widget.node',
      libc: ['glibc'],
      repository: { type: 'git', url: 'https://github.com/acme/widget' },
      license: 'MIT',
      homepage: 'https://acme.dev',
    });
    expect(writeFileMock.mock.calls[0]![1]).toBe(JSON.stringify(writtenJson(), null, 2) + '\n');
  });

  it('omits libc, repository, license, and homepage when absent', async () => {
    osCpuMock.mockReturnValue({ os: ['darwin'], cpu: ['arm64'] });
    await synth();
    expect(writtenJson()).toEqual({
      name: 'widget-linux-x64-gnu',
      version: '1.2.3',
      os: ['darwin'],
      cpu: ['arm64'],
      files: ['widget.node', 'README.md'],
      main: 'widget.node',
    });
  });

  it('marks the bundled-cli main file executable on non-Windows targets', async () => {
    pickMainMock.mockResolvedValue(join('bin', 'widget'));
    await synth(cli);
    expect(chmodMock).toHaveBeenCalledWith(join(STAGING, 'bin', 'widget'), 0o755);
  });

  it('leaves modes alone for napi and for Windows bundled-cli targets', async () => {
    await synth(napi);
    osCpuMock.mockReturnValue({ os: ['win32'], cpu: ['x64'] });
    await synth(cli);
    expect(chmodMock).not.toHaveBeenCalled();
  });
});
