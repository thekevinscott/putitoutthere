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

import { pypi, scmEnvSuffix } from './pypi.js';
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
    globs: ['**'],
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

  it('throws when [project] is present but declares neither static version nor dynamic (issue #171)', async () => {
    const p = join(dir, 'pyproject.toml');
    writeFileSync(
      p,
      `[project]\nname = "demo"\nrequires-python = ">=3.10"\n\n[build-system]\nrequires = ["hatchling"]\n`,
      'utf8',
    );
    await expect(
      pypi.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir })),
    ).rejects.toThrow(/\[project\] is present but declares neither a static version nor dynamic/);
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

  // --- issue #171: dynamic-version projects --------------------------------

  it('skips the rewrite when [project].dynamic contains "version" (hatch-vcs / setuptools-scm)', async () => {
    const p = join(dir, 'pyproject.toml');
    const src =
      `[project]\nname = "demo"\ndynamic = ["version"]\nrequires-python = ">=3.10"\n` +
      `\n[build-system]\nrequires = ["hatchling", "hatch-vcs"]\nbuild-backend = "hatchling.build"\n` +
      `\n[tool.hatch.version]\nsource = "vcs"\n`;
    writeFileSync(p, src, 'utf8');
    const infoSpy = vi.fn();
    const paths = await pypi.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.0',
      makeCtx({
        cwd: dir,
        log: { debug: () => {}, info: infoSpy, warn: () => {}, error: () => {} },
      }),
    );
    expect(paths).toEqual([]);
    // File is untouched -- no literal version line was synthesised.
    expect(readFileSync(p, 'utf8')).toBe(src);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const msg = infoSpy.mock.calls[0]![0] as string;
    expect(msg).toMatch(/dynamic version/i);
    expect(msg).toMatch(/skipping pyproject\.toml rewrite/i);
    // Actionable guidance (#207): tells the reader which env var to set.
    expect(msg).toContain('SETUPTOOLS_SCM_PRETEND_VERSION_FOR_DEMO');
    expect(msg).toContain('0.2.0');
    expect(msg).toContain('dynamic-versions');
  });

  it('skips the rewrite when "version" is one of several entries in dynamic', async () => {
    const p = join(dir, 'pyproject.toml');
    const src = `[project]\nname = "demo"\ndynamic = ["readme", "version", "dependencies"]\n`;
    writeFileSync(p, src, 'utf8');
    const infoSpy = vi.fn();
    const paths = await pypi.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.0',
      makeCtx({
        cwd: dir,
        log: { debug: () => {}, info: infoSpy, warn: () => {}, error: () => {} },
      }),
    );
    expect(paths).toEqual([]);
    expect(readFileSync(p, 'utf8')).toBe(src);
    expect(infoSpy).toHaveBeenCalled();
  });

  it('rewrites normally when dynamic array is present but does not include "version"', async () => {
    const p = join(dir, 'pyproject.toml');
    writeFileSync(
      p,
      `[project]\nname = "demo"\nversion = "0.1.0"\ndynamic = ["readme", "dependencies"]\n`,
      'utf8',
    );
    const paths = await pypi.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.0',
      makeCtx({ cwd: dir }),
    );
    expect(paths).toContain(p);
    expect(readFileSync(p, 'utf8')).toContain('version = "0.2.0"');
  });

  it('throws with a distinct message when [project] table is absent entirely', async () => {
    const p = join(dir, 'pyproject.toml');
    writeFileSync(
      p,
      `[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n`,
      'utf8',
    );
    await expect(
      pypi.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir })),
    ).rejects.toThrow(/no \[project\] table/);
  });

  it('surfaces the TOML parser message with the file path when pyproject.toml is malformed', async () => {
    const p = join(dir, 'pyproject.toml');
    // Unterminated string -- guaranteed parse failure.
    writeFileSync(p, `[project]\nname = "demo\nversion = "0.1.0"\n`, 'utf8');
    await expect(
      pypi.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir })),
    ).rejects.toThrow(new RegExp(`failed to parse.*${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
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

  it('runs twine upload with --verbose so 4xx response bodies surface (#244)', async () => {
    // Plain `twine upload` returns "400 Bad Request from
    // https://upload.pypi.org/legacy/" with no body. The actual reason
    // (filename mismatch, missing trusted-publisher claim, malformed
    // metadata) only appears under --verbose. Hard-coded so a future
    // edit can't quietly drop it.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    stageSdist('demo-python-sdist', 'demo-python-0.1.0.tar.gz');
    execMock.mockReturnValueOnce(Buffer.from(''));
    process.env.PYPI_API_TOKEN = 'pypi-tok';
    await pypi.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({
        cwd: dir,
        artifactsRoot,
        env: { PYPI_API_TOKEN: 'pypi-tok' },
      }),
    );
    const args = execMock.mock.calls[0]![1] as string[];
    expect(args).toContain('--verbose');
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
    ).rejects.toThrow(/PYPI_API_TOKEN/i);
    fetchSpy.mockRestore();
  });

  it('no-auth error points at the published auth guide, not internal plan docs (#149)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    stageSdist('demo-python-sdist', 'demo-0.1.0.tar.gz');
    try {
      await pypi.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, artifactsRoot }),
      );
      throw new Error('expected publish to reject');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(
        /thekevinscott\.github\.io\/putitoutthere\/guide\/auth/,
      );
      expect(msg).not.toMatch(/plan\.md/);
      expect(msg).not.toMatch(/§16\.4/);
    } finally {
      fetchSpy.mockRestore();
    }
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

  it('surfaces twine failure stdout when stderr is empty (#244)', async () => {
    // Twine sometimes writes a 4xx/5xx response body or an unsupported-
    // metadata diagnostic to stdout rather than stderr. The previous
    // wrapper only forwarded stderr; the actual failure was lost and
    // adopters saw a bare "Command failed" with no signal.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    stageSdist('demo-python-sdist', 'demo-0.1.0.tar.gz');
    execMock.mockImplementation(() => {
      throw Object.assign(new Error('twine exit 1'), {
        stdout: Buffer.from('HTTPError: 400 Bad Request from https://upload.pypi.org/legacy/\nThe description failed to render in the default format of reStructuredText.'),
        stderr: Buffer.from(''),
      });
    });
    process.env.PYPI_API_TOKEN = 'tok';
    await expect(
      pypi.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, artifactsRoot }),
      ),
    ).rejects.toThrow(/HTTPError: 400|reStructuredText/i);
    fetchSpy.mockRestore();
  });

  it('wraps ENOENT (twine not on PATH) with an actionable pointer at runner prereqs (#205)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    stageSdist('demo-python-sdist', 'demo-0.1.0.tar.gz');
    // execFileSync throws a NodeJS.ErrnoException with code === 'ENOENT'
    // when the spawn target doesn't exist on PATH — shape we reproduce here.
    execMock.mockImplementation(() => {
      throw Object.assign(new Error('spawn twine ENOENT'), { code: 'ENOENT' });
    });
    process.env.PYPI_API_TOKEN = 'tok';
    try {
      await pypi.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, artifactsRoot }),
      );
      throw new Error('expected ENOENT to surface');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/twine not found on PATH/);
      expect(msg).toMatch(/pip install twine/);
      expect(msg).toMatch(/runner-prerequisites/);
    } finally {
      fetchSpy.mockRestore();
    }
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

  it('OIDC wins when both PYPI_API_TOKEN and OIDC env are present', async () => {
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
        return Promise.resolve(new Response(JSON.stringify({ token: 'pypi-oidc' }), { status: 200 }));
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
          PYPI_API_TOKEN: 'stale-classic-token',
          ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gha.example/oidc/request-token?abc',
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'gha-token',
        },
      }),
    );

    expect(result.status).toBe('published');
    const env = (execMock.mock.calls[0]![2] as { env: Record<string, string> }).env;
    expect(env.TWINE_PASSWORD).toBe('pypi-oidc');
    expect(env.TWINE_PASSWORD).not.toBe('stale-classic-token');
    fetchSpy.mockRestore();
  });

  it('falls back to PYPI_API_TOKEN when OIDC mint fails but token is set', async () => {
    stageSdist('demo-python-sdist', 'demo-0.1.0.tar.gz');
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/pypi/demo-pkg/0.1.0/json')) {
        return Promise.resolve(new Response('{}', { status: 404 }));
      }
      if (url.includes('/oidc/request-token')) {
        return Promise.resolve(new Response('', { status: 500 }));
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
          PYPI_API_TOKEN: 'classic-token',
          ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gha.example/oidc/request-token?abc',
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'gha-token',
        },
      }),
    );

    expect(result.status).toBe('published');
    const env = (execMock.mock.calls[0]![2] as { env: Record<string, string> }).env;
    expect(env.TWINE_PASSWORD).toBe('classic-token');
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

  // #237: collectArtifacts must encode `/` in pkg.name so the on-disk
  // artifact directory (`py__cachetta-sdist`, emitted by the planner)
  // is matched. Pre-fix, `entry.startsWith("py/cachetta-")` failed
  // against `"py__cachetta-sdist"` and the handler reported "no
  // artifacts found".
  it('finds artifacts for a pkg.name containing `/` (encoded directory match)', async () => {
    stageSdist('py__cachetta-sdist', 'cachetta-0.6.2.tar.gz');
    process.env.PYPI_API_TOKEN = 'tok';
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockReturnValue('ok');
    const result = await pypi.publish(
      { ...basePkg({ name: 'py/cachetta', pypi: 'cachetta' }), path: dir },
      '0.6.2',
      makeCtx({ cwd: dir, artifactsRoot, env: { PYPI_API_TOKEN: 'tok' } }),
    );
    expect(result.status).toBe('published');
    expect(execMock).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  // #237: upload-artifact@v4 with a directory `path:` writes contents
  // flat under `<artifact>/`, but with a single-glob `path:` it
  // preserves the workspace-relative path so the file ends up at
  // `<artifact>/packages/python/dist/foo.tar.gz`. The handler must
  // tolerate either layout.
  it('finds artifacts in a nested workspace-relative subdirectory', async () => {
    const artifactDir = join(artifactsRoot, 'demo-python-sdist');
    const nested = join(artifactDir, 'packages', 'python', 'dist');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'demo-0.1.0.tar.gz'), 'fake', 'utf8');
    process.env.PYPI_API_TOKEN = 'tok';
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockReturnValue('ok');
    const result = await pypi.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, artifactsRoot, env: { PYPI_API_TOKEN: 'tok' } }),
    );
    expect(result.status).toBe('published');
    // twine should have been invoked with the nested file path.
    const calls = execMock.mock.calls as readonly unknown[][];
    const tarballArg = calls
      .flatMap((c) => (Array.isArray(c[1]) ? (c[1] as readonly unknown[]) : []))
      .find((a): a is string => typeof a === 'string' && a.endsWith('demo-0.1.0.tar.gz'));
    expect(tarballArg).toBeDefined();
    expect(tarballArg).toContain(join('packages', 'python', 'dist'));
    fetchSpy.mockRestore();
  });
});

describe('scmEnvSuffix (#207)', () => {
  it('uppercases + collapses dashes, dots, underscores to `_` per PEP 503', () => {
    expect(scmEnvSuffix('my-lib')).toBe('MY_LIB');
    expect(scmEnvSuffix('my.lib')).toBe('MY_LIB');
    expect(scmEnvSuffix('my_lib')).toBe('MY_LIB');
    expect(scmEnvSuffix('my--lib')).toBe('MY_LIB');
    expect(scmEnvSuffix('coaxer')).toBe('COAXER');
  });
});
