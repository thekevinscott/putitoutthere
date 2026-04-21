/**
 * PyPI handler tests.
 *
 * Issue #17. Plan: §6.4, §12.2, §12.3, §13.1, §14.5.
 */

import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pypi } from './pypi.js';
import type { Ctx } from '../types.js';

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return {
    ...actual,
    execFileSync: vi.fn(actual.execFileSync),
  };
});

const execMock = vi.mocked(execFileSync);

function makeCtx(over: Partial<Ctx> = {}): Ctx {
  return {
    cwd: '.',
    dryRun: false,
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    env: {},
    artifacts: { get: () => '', has: () => false },
    ...over,
  };
}

function basePkg(over: Partial<{ name: string; path: string; pypi?: string; build?: string }> = {}): Parameters<typeof pypi.isPublished>[0] {
  return {
    name: 'demo-python',
    kind: 'pypi',
    path: '.',
    paths: ['**'],
    depends_on: [],
    first_version: '0.1.0',
    pypi: 'demo-pkg',
    ...over,
  };
}

const ENV_BAK = { ...process.env };

beforeEach(() => {
  execMock.mockReset();
  delete process.env.PYPI_API_TOKEN;
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ENV_BAK)) delete process.env[k];
  }
  Object.assign(process.env, ENV_BAK);
});

describe('pypi.isPublished', () => {
  it('returns true on 200', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    expect(await pypi.isPublished(basePkg(), '0.1.0', makeCtx())).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://pypi.org/pypi/demo-pkg/0.1.0/json',
      expect.any(Object) as object,
    );
    fetchSpy.mockRestore();
  });

  it('returns false on 404', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    expect(await pypi.isPublished(basePkg(), '0.1.0', makeCtx())).toBe(false);
    fetchSpy.mockRestore();
  });

  it('falls back to package.name when no pypi field', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    const pkg = basePkg();
    delete (pkg as { pypi?: string }).pypi;
    await pypi.isPublished(pkg, '0.1.0', makeCtx());
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://pypi.org/pypi/demo-python/0.1.0/json',
      expect.any(Object) as object,
    );
    fetchSpy.mockRestore();
  });

  it('throws TransientError on 5xx', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 502 }),
    );
    await expect(pypi.isPublished(basePkg(), '0.1.0', makeCtx())).rejects.toThrow(/transient|502/i);
    fetchSpy.mockRestore();
  });
});

describe('pypi.writeVersion', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pypi-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rewrites the [project].version field in pyproject.toml', async () => {
    const p = join(dir, 'pyproject.toml');
    writeFileSync(
      p,
      `[project]\nname = "demo"\nversion = "0.1.0"\nrequires-python = ">=3.10"\n`,
      'utf8',
    );
    const paths = await pypi.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.0',
      makeCtx({ cwd: dir }),
    );
    const out = readFileSync(p, 'utf8');
    expect(out).toContain('version = "0.2.0"');
    expect(out).not.toContain('version = "0.1.0"');
    expect(paths).toContain(p);
  });

  it('is idempotent when version already matches', async () => {
    const p = join(dir, 'pyproject.toml');
    writeFileSync(p, `[project]\nname = "demo"\nversion = "1.0.0"\n`, 'utf8');
    const paths = await pypi.writeVersion(
      { ...basePkg(), path: dir },
      '1.0.0',
      makeCtx({ cwd: dir }),
    );
    expect(paths).toEqual([]);
  });

  it('throws when pyproject.toml is missing', async () => {
    await expect(
      pypi.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir })),
    ).rejects.toThrow(/pyproject\.toml/);
  });

  it('throws when [project].version field is absent', async () => {
    const p = join(dir, 'pyproject.toml');
    writeFileSync(p, `[build-system]\nrequires = ["hatchling"]\n`, 'utf8');
    await expect(
      pypi.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir })),
    ).rejects.toThrow(/version/i);
  });

  it('preserves comments', async () => {
    const p = join(dir, 'pyproject.toml');
    writeFileSync(
      p,
      `[project]\n# keep\nname = "demo"\nversion = "0.1.0" # trailing\n`,
      'utf8',
    );
    await pypi.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.0',
      makeCtx({ cwd: dir }),
    );
    const out = readFileSync(p, 'utf8');
    expect(out).toContain('# keep');
    expect(out).toContain('# trailing');
    expect(out).toContain('version = "0.2.0"');
  });
});

describe('pypi.publish', () => {
  let dir: string;
  let artifactsRoot: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pypi-pub-'));
    artifactsRoot = join(dir, 'artifacts');
    mkdirSync(artifactsRoot, { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function stageWheel(artifactName: string, wheelFile: string): void {
    const d = join(artifactsRoot, artifactName);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, wheelFile), 'fake', 'utf8');
  }
  function stageSdist(artifactName: string, sdistFile: string): void {
    const d = join(artifactsRoot, artifactName);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, sdistFile), 'fake', 'utf8');
  }

  it('skips when already published', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    const result = await pypi.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, artifactsRoot }),
    );
    expect(result.status).toBe('already-published');
    expect(execMock).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('runs twine upload with collected artifacts', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    stageWheel(
      'demo-python-wheel-x86_64-unknown-linux-gnu',
      'demo-0.1.0-cp310-cp310-manylinux_2_17_x86_64.whl',
    );
    stageSdist('demo-python-sdist', 'demo-0.1.0.tar.gz');
    execMock.mockReturnValueOnce(Buffer.from(''));
    process.env.PYPI_API_TOKEN = 'pypi-tok';

    const result = await pypi.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({
        cwd: dir,
        artifactsRoot,
        env: { PYPI_API_TOKEN: 'pypi-tok' },
      }),
    );
    expect(result.status).toBe('published');
    expect(execMock).toHaveBeenCalledWith(
      'twine',
      expect.arrayContaining(['upload']) as string[],
      expect.any(Object) as object,
    );
    // Called with the two files we staged (wheel + sdist).
    const args = execMock.mock.calls[0]![1] as string[];
    expect(args.some((a) => a.endsWith('.whl'))).toBe(true);
    expect(args.some((a) => a.endsWith('.tar.gz'))).toBe(true);
    fetchSpy.mockRestore();
  });

  it('dry-run: does not call twine', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    stageSdist('demo-python-sdist', 'demo-0.1.0.tar.gz');
    const result = await pypi.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, artifactsRoot, dryRun: true }),
    );
    expect(result.status).toBe('skipped');
    expect(execMock).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('fails loudly when PYPI_API_TOKEN is not set', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    stageSdist('demo-python-sdist', 'demo-0.1.0.tar.gz');
    await expect(
      pypi.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, artifactsRoot }),
      ),
    ).rejects.toThrow(/PYPI_API_TOKEN|§16\.4/i);
    fetchSpy.mockRestore();
  });

  it('fails loudly when no artifacts for this package', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    process.env.PYPI_API_TOKEN = 'pypi-tok';
    await expect(
      pypi.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, artifactsRoot }),
      ),
    ).rejects.toThrow(/no artifacts|demo-python/i);
    fetchSpy.mockRestore();
  });

  it('surfaces twine failure stderr', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    stageSdist('demo-python-sdist', 'demo-0.1.0.tar.gz');
    execMock.mockImplementation(() => {
      throw Object.assign(new Error('twine exit 1'), { stderr: Buffer.from('401 unauthorized') });
    });
    process.env.PYPI_API_TOKEN = 'tok';
    await expect(
      pypi.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, artifactsRoot }),
      ),
    ).rejects.toThrow(/unauthorized|twine/i);
    fetchSpy.mockRestore();
  });

  it('mints a short-lived token via OIDC when PYPI_API_TOKEN is unset', async () => {
    stageSdist('demo-python-sdist', 'demo-0.1.0.tar.gz');
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/pypi/demo-pkg/0.1.0/json')) {
        return Promise.resolve(new Response('{}', { status: 404 }));
      }
      if (url.includes('/oidc/request-token') && url.includes('audience=pypi')) {
        return Promise.resolve(new Response(JSON.stringify({ value: 'gha-id-token' }), { status: 200 }));
      }
      if (url.endsWith('/_/oidc/mint-token')) {
        return Promise.resolve(new Response(JSON.stringify({ token: 'pypi-short-lived' }), { status: 200 }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    execMock.mockReturnValueOnce(Buffer.from(''));

    const result = await pypi.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({
        cwd: dir,
        artifactsRoot,
        env: {
          ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gha.example/oidc/request-token?abc',
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'gha-token',
        },
      }),
    );

    expect(result.status).toBe('published');
    const env = (execMock.mock.calls[0]![2] as { env: Record<string, string> }).env;
    expect(env.TWINE_PASSWORD).toBe('pypi-short-lived');
    fetchSpy.mockRestore();
  });

  it('treats empty PYPI_API_TOKEN as unset (falls through to OIDC, then errors when OIDC unavailable)', async () => {
    stageSdist('demo-python-sdist', 'demo-0.1.0.tar.gz');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    await expect(
      pypi.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, artifactsRoot, env: { PYPI_API_TOKEN: '' } }),
      ),
    ).rejects.toThrow(/PYPI_API_TOKEN|OIDC/i);
    fetchSpy.mockRestore();
  });

  it('auth-missing error mentions both the token path and trusted publishing', async () => {
    stageSdist('demo-python-sdist', 'demo-0.1.0.tar.gz');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    await expect(
      pypi.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, artifactsRoot }),
      ),
    ).rejects.toThrow(/PYPI_API_TOKEN[\s\S]+id-token: write/);
    fetchSpy.mockRestore();
  });
});
