import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSubprocessEnv } from '../env.js';
import type { Ctx } from '../types.js';
import { execCapture } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';
import { isPlatformPublished } from './is-platform-published.js';
import type { PlatformPkg } from './npm-platform.js';
import { publishPlatformPackage } from './publish-platform-package.js';
import { readStagedIdentity } from './read-staged-identity.js';

vi.mock('../env.js', async () => await vi.importActual<typeof import('../env.js')>('../env.js'));
vi.mock('../utils/exec-error.js', async () => await vi.importActual<typeof import('../utils/exec-error.js')>('../utils/exec-error.js'));
vi.mock('../utils/exec-capture.js');
vi.mock('./is-platform-published.js');
vi.mock('./read-staged-identity.js');

const execMock = vi.mocked(execCapture);
const isPublishedMock = vi.mocked(isPlatformPublished);
const readStagedMock = vi.mocked(readStagedIdentity);

const TLOG_STDERR =
  'npm error code TLOG_CREATE_ENTRY_ERROR\n' +
  'npm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log';

function makeCtx(env: Record<string, string> = {}): Ctx {
  return {
    cwd: '/repo',
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    env,
    artifacts: { get: () => '', has: () => false },
  };
}

function makePkg(over: Partial<PlatformPkg> = {}): PlatformPkg {
  return {
    name: 'demo-cli',
    path: '/repo/pkg',
    build: [{ mode: 'napi', name: '{name}-{triple}' }],
    targets: ['linux-x64-gnu'],
    ...over,
  };
}

function publishArgs(): readonly string[] {
  return execMock.mock.calls[0]![1];
}

beforeEach(() => {
  execMock.mockReset();
  isPublishedMock.mockReset();
  readStagedMock.mockReset();
  execMock.mockResolvedValue({ stdout: '', stderr: '' });
  vi.stubEnv('PIOT_NPM_REGISTRY', '');
  vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('publishPlatformPackage: npm invocation', () => {
  it('publishes the staging dir positionally from cwd=pkg.path with public access by default (#305)', async () => {
    const ctx = makeCtx({ NODE_AUTH_TOKEN: 'tok' });
    await publishPlatformPackage('/tmp/stage', makePkg(), ctx);
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock).toHaveBeenCalledWith(
      'npm',
      ['publish', '--access=public', '/tmp/stage'],
      { cwd: '/repo/pkg', env: buildSubprocessEnv(ctx.env) },
    );
  });

  it('forwards the package access and tag', async () => {
    await publishPlatformPackage('/tmp/stage', makePkg({ access: 'restricted', tag: 'next' }), makeCtx());
    expect(publishArgs()).toEqual(['publish', '--access=restricted', '--tag=next', '/tmp/stage']);
  });

  it('adds --provenance when the OIDC token is in ctx.env', async () => {
    await publishPlatformPackage('/tmp/stage', makePkg(), makeCtx({ ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc' }));
    expect(publishArgs()).toEqual(['publish', '--access=public', '--provenance', '/tmp/stage']);
  });

  it('adds --provenance when the OIDC token is only in process.env', async () => {
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'oidc');
    await publishPlatformPackage('/tmp/stage', makePkg(), makeCtx());
    expect(publishArgs()).toEqual(['publish', '--access=public', '--provenance', '/tmp/stage']);
  });

  it('forwards --registry and suppresses --provenance when PIOT_NPM_REGISTRY is in ctx.env (#304)', async () => {
    await publishPlatformPackage(
      '/tmp/stage',
      makePkg(),
      makeCtx({ PIOT_NPM_REGISTRY: 'http://localhost:4873', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc' }),
    );
    expect(publishArgs()).toEqual(['publish', '--access=public', '--registry=http://localhost:4873', '/tmp/stage']);
  });

  it('forwards --registry when PIOT_NPM_REGISTRY is only in process.env', async () => {
    vi.stubEnv('PIOT_NPM_REGISTRY', 'http://localhost:4873');
    await publishPlatformPackage('/tmp/stage', makePkg(), makeCtx());
    expect(publishArgs()).toEqual(['publish', '--access=public', '--registry=http://localhost:4873', '/tmp/stage']);
  });
});

describe('publishPlatformPackage: failures', () => {
  it('treats npm\'s E403 over-publish retry race as success without re-probing', async () => {
    execMock.mockRejectedValue(
      new ExecError('publish failed', '', 'npm error 403 You cannot publish over the previously published versions: 0.2.0.\n', 1),
    );
    await expect(publishPlatformPackage('/tmp/stage', makePkg(), makeCtx())).resolves.toBeUndefined();
    expect(readStagedMock).not.toHaveBeenCalled();
    expect(isPublishedMock).not.toHaveBeenCalled();
  });

  it('treats a TLOG 409 as success when the staged coordinate is on the registry (#399)', async () => {
    execMock.mockRejectedValue(new ExecError('publish failed', '', TLOG_STDERR, 1));
    readStagedMock.mockResolvedValue({ name: 'demo-cli-linux-x64-gnu', version: '0.2.0' });
    isPublishedMock.mockResolvedValue(true);
    const ctx = makeCtx();
    await expect(publishPlatformPackage('/tmp/stage', makePkg(), ctx)).resolves.toBeUndefined();
    expect(readStagedMock).toHaveBeenCalledWith('/tmp/stage');
    expect(isPublishedMock).toHaveBeenCalledWith('demo-cli-linux-x64-gnu', '0.2.0', ctx);
  });

  it('throws an actionable re-run error on a TLOG 409 when the coordinate is NOT on the registry', async () => {
    const cause = new ExecError('publish failed', '', `${TLOG_STDERR}\n`, 1);
    execMock.mockRejectedValue(cause);
    readStagedMock.mockResolvedValue({ name: 'demo-cli-linux-x64-gnu', version: '0.2.0' });
    isPublishedMock.mockResolvedValue(false);
    const err = await publishPlatformPackage('/tmp/stage', makePkg(), makeCtx()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(
      'npm publish (platform) failed: Sigstore transparency-log dedupe ' +
        '(TLOG_CREATE_ENTRY_ERROR) and demo-cli-linux-x64-gnu@0.2.0 is not ' +
        'on the registry — npm\'s provenance retry re-submitted an identical ' +
        'attestation. Re-run the release to mint a fresh attestation.' +
        `\n${TLOG_STDERR}`,
    );
    expect((err as Error).cause).toBe(cause);
  });

  it('reports trimmed npm stderr on any other failure', async () => {
    const cause = new ExecError('publish failed', '', '\n  npm error 500 Internal Server Error  \n', 1);
    execMock.mockRejectedValue(cause);
    const err = await publishPlatformPackage('/tmp/stage', makePkg(), makeCtx()).catch((e: unknown) => e);
    expect((err as Error).message).toBe('npm publish (platform) failed:\nnpm error 500 Internal Server Error');
    expect((err as Error).cause).toBe(cause);
  });

  it('falls back to the error message when stderr is empty', async () => {
    execMock.mockRejectedValue(new ExecError('spawn npm ENOENT', '', '', null));
    await expect(publishPlatformPackage('/tmp/stage', makePkg(), makeCtx())).rejects.toThrow(
      /^npm publish \(platform\) failed: spawn npm ENOENT$/,
    );
  });

  it('falls back to String(err) for a non-Error rejection', async () => {
    execMock.mockRejectedValue('boom');
    await expect(publishPlatformPackage('/tmp/stage', makePkg(), makeCtx())).rejects.toThrow(
      /^npm publish \(platform\) failed: boom$/,
    );
  });

  it('uses the plain Error message when the rejection is not an ExecError', async () => {
    execMock.mockRejectedValue(new Error('network down'));
    await expect(publishPlatformPackage('/tmp/stage', makePkg(), makeCtx())).rejects.toThrow(
      /^npm publish \(platform\) failed: network down$/,
    );
  });
});
