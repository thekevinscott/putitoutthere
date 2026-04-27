/**
 * npm handler (vanilla) tests.
 *
 * Issue #18. Plan: §7.4, §12.2 (vanilla mode), §13.1, §14.5, §16.1.
 */

import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isBootstrapPublish, npm } from './npm.js';
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

function basePkg(over: Partial<{ name: string; path: string; npm?: string; access?: 'public' | 'restricted'; tag?: string }> = {}): Parameters<typeof npm.isPublished>[0] {
  return {
    name: 'demo-js',
    kind: 'npm',
    path: '.',
    globs: ['**'],
    depends_on: [],
    first_version: '0.1.0',
    npm: 'demo-npm',
    ...over,
  };
}

const ENV_BAK = { ...process.env };

beforeEach(() => {
  execMock.mockReset();
  delete process.env.NODE_AUTH_TOKEN;
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ENV_BAK)) delete process.env[k];
  }
  Object.assign(process.env, ENV_BAK);
});

describe('npm.isPublished', () => {
  it('returns true when `npm view` exits 0 (version exists)', async () => {
    execMock.mockReturnValueOnce(Buffer.from('0.1.0\n'));
    expect(await npm.isPublished(basePkg(), '0.1.0', makeCtx())).toBe(true);
    expect(execMock).toHaveBeenCalledWith(
      'npm',
      ['view', 'demo-npm@0.1.0', 'version'],
      expect.any(Object) as object,
    );
  });

  it('returns false when `npm view` exits non-zero (version missing)', async () => {
    execMock.mockImplementation(() => {
      throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
    });
    expect(await npm.isPublished(basePkg(), '0.1.0', makeCtx())).toBe(false);
  });

  it('falls back to package.name when no npm field', async () => {
    execMock.mockReturnValueOnce(Buffer.from('0.1.0\n'));
    const pkg = basePkg();
    delete (pkg as { npm?: string }).npm;
    await npm.isPublished(pkg, '0.1.0', makeCtx());
    expect(execMock).toHaveBeenCalledWith(
      'npm',
      ['view', 'demo-js@0.1.0', 'version'],
      expect.any(Object) as object,
    );
  });
});

describe('npm.writeVersion', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'npm-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rewrites the version field in package.json', async () => {
    const p = join(dir, 'package.json');
    writeFileSync(
      p,
      JSON.stringify({ name: 'demo', version: '0.1.0', main: 'index.js' }, null, 2),
      'utf8',
    );
    const paths = await npm.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.0',
      makeCtx({ cwd: dir }),
    );
    const out = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    expect(out.version).toBe('0.2.0');
    expect(out.name).toBe('demo');
    expect(paths).toContain(p);
  });

  it('is idempotent when version already matches', async () => {
    const p = join(dir, 'package.json');
    writeFileSync(p, JSON.stringify({ name: 'demo', version: '1.0.0' }), 'utf8');
    const paths = await npm.writeVersion(
      { ...basePkg(), path: dir },
      '1.0.0',
      makeCtx({ cwd: dir }),
    );
    expect(paths).toEqual([]);
  });

  it('throws when package.json is missing', async () => {
    await expect(
      npm.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir })),
    ).rejects.toThrow(/package\.json/);
  });

  it('throws when package.json is malformed JSON', async () => {
    writeFileSync(join(dir, 'package.json'), 'not json', 'utf8');
    await expect(
      npm.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir })),
    ).rejects.toThrow(/JSON|parse/i);
  });

  it('preserves 2-space indentation', async () => {
    const p = join(dir, 'package.json');
    writeFileSync(
      p,
      JSON.stringify({ name: 'demo', version: '0.1.0' }, null, 2),
      'utf8',
    );
    await npm.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.0',
      makeCtx({ cwd: dir }),
    );
    expect(readFileSync(p, 'utf8')).toContain('  "version": "0.2.0"');
  });
});

describe('npm.publish', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'npm-pub-'));
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'demo-npm',
        version: '0.1.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      }),
      'utf8',
    );
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips when already-published', async () => {
    execMock.mockReturnValueOnce(Buffer.from('0.1.0')); // npm view → exists
    const result = await npm.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir }),
    );
    expect(result.status).toBe('already-published');
    expect(execMock).toHaveBeenCalledTimes(1); // only the view
  });

  it('runs npm publish when not already-published', async () => {
    // First call: npm view → throws (404); second call: npm publish → ok.
    execMock
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('404'), { status: 1 });
      })
      .mockReturnValueOnce(Buffer.from(''));
    process.env.NODE_AUTH_TOKEN = 'npm-tok';

    const result = await npm.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, env: { NODE_AUTH_TOKEN: 'npm-tok' } }),
    );
    expect(result.status).toBe('published');
    // The second call is npm publish.
    const publishCall = execMock.mock.calls[1]!;
    expect(publishCall[0]).toBe('npm');
    expect(publishCall[1]).toContain('publish');
  });

  it('napi: publishes platform packages before main', async () => {
    // Set up artifactsRoot with a platform artifact.
    const artifactsRoot = join(dir, 'artifacts');
    mkdirSync(join(artifactsRoot, 'demo-js-linux-x64-gnu'), { recursive: true });
    writeFileSync(join(artifactsRoot, 'demo-js-linux-x64-gnu', 'demo.node'), Buffer.from('x'));

    const viewCalls: string[] = [];
    const publishCwds: string[] = [];
    execMock.mockImplementation((_cmd, args, opts) => {
      const a = args as string[];
      const cwd = (opts as { cwd?: string } | undefined)?.cwd ?? '';
      if (a[0] === 'view') {
        viewCalls.push(String(a[1]));
        throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      }
      if (a[0] === 'publish') publishCwds.push(cwd);
      return Buffer.from('');
    });

    const result = await npm.publish(
      { ...basePkg(), path: dir, build: 'napi', targets: ['linux-x64-gnu'] },
      '0.1.0',
      makeCtx({ cwd: dir, artifactsRoot }),
    );
    expect(result.status).toBe('published');
    // Both platform + main should have been viewed.
    expect(viewCalls).toContain('demo-npm@0.1.0');
    expect(viewCalls.some((v) => v.startsWith('demo-npm-linux-x64-gnu'))).toBe(true);
    // Two publishes: one platform (staging dir) + one main (dir).
    expect(publishCwds).toHaveLength(2);
    expect(publishCwds[1]).toBe(dir);
  });

  it('dry-run: does not call npm publish', async () => {
    execMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('404'), { status: 1 });
    });
    const result = await npm.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, dryRun: true }),
    );
    expect(result.status).toBe('skipped');
  });

  it('uses --access public by default (explicit on config)', async () => {
    execMock
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('404'), { status: 1 });
      })
      .mockReturnValueOnce(Buffer.from(''));
    process.env.NODE_AUTH_TOKEN = 'tok';
    await npm.publish(
      { ...basePkg({ access: 'public' }), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, env: { NODE_AUTH_TOKEN: 'tok' } }),
    );
    expect(execMock.mock.calls[1]![1]).toContain('--access=public');
  });

  it('uses --access restricted when set', async () => {
    execMock
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('404'), { status: 1 });
      })
      .mockReturnValueOnce(Buffer.from(''));
    process.env.NODE_AUTH_TOKEN = 'tok';
    await npm.publish(
      { ...basePkg({ access: 'restricted' }), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, env: { NODE_AUTH_TOKEN: 'tok' } }),
    );
    expect(execMock.mock.calls[1]![1]).toContain('--access=restricted');
  });

  it('passes --tag when set', async () => {
    execMock
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('404'), { status: 1 });
      })
      .mockReturnValueOnce(Buffer.from(''));
    process.env.NODE_AUTH_TOKEN = 'tok';
    await npm.publish(
      { ...basePkg({ tag: 'next' }), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, env: { NODE_AUTH_TOKEN: 'tok' } }),
    );
    expect(execMock.mock.calls[1]![1]).toContain('--tag=next');
  });

  it('enables --provenance when OIDC env is present', async () => {
    execMock
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('404'), { status: 1 });
      })
      .mockReturnValueOnce(Buffer.from(''));
    process.env.NODE_AUTH_TOKEN = 'tok';
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'oidc-present';
    await npm.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, env: { NODE_AUTH_TOKEN: 'tok', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-present' } }),
    );
    expect(execMock.mock.calls[1]![1]).toContain('--provenance');
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  });

  it('requires the repository field in package.json when OIDC is on', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'demo-npm', version: '0.1.0' }),
      'utf8',
    );
    execMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('404'), { status: 1 });
    });
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'oidc-present';
    await expect(
      npm.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, env: { ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-present' } }),
      ),
    ).rejects.toThrow(/repository/i);
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  });

  it('surfaces publish failure stderr', async () => {
    execMock
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('404'), { status: 1 });
      })
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('exit 1'), { stderr: Buffer.from('EAUTH') });
      });
    process.env.NODE_AUTH_TOKEN = 'tok';
    await expect(
      npm.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, env: { NODE_AUTH_TOKEN: 'tok' } }),
      ),
    ).rejects.toThrow(/EAUTH|npm publish/i);
  });

  it('treats empty ACTIONS_ID_TOKEN_REQUEST_TOKEN as unset (falls through to process.env)', async () => {
    execMock
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('404'), { status: 1 });
      })
      .mockReturnValueOnce(Buffer.from(''));
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'oidc-real';
    await npm.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({
        cwd: dir,
        env: {
          NODE_AUTH_TOKEN: 'tok',
          // Empty string must not shadow the populated process.env value.
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: '',
        },
      }),
    );
    expect(execMock.mock.calls[1]![1]).toContain('--provenance');
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  });

  it('on auth-failure with OIDC + package-not-on-registry, surfaces the bootstrap-paradox hint', async () => {
    execMock
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('404'), { status: 1 });
      })
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('npm exit 1'), {
          stderr: Buffer.from('npm error code E401\nnpm error need auth'),
        });
      });
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'oidc-present';
    await expect(
      npm.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, env: { ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-present' } }),
      ),
    ).rejects.toThrow(/does not exist on registry.npmjs.org|Bootstrap/);
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    fetchSpy.mockRestore();
  });

  it('bootstrap-paradox check: unscoped names hit /<name> on the registry', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    expect(await isBootstrapPublish('demo-npm')).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://registry.npmjs.org/demo-npm',
      expect.any(Object) as object,
    );
    fetchSpy.mockRestore();
  });

  it('bootstrap-paradox check: scoped names keep `@`, encode `/`', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    await isBootstrapPublish('@scope/name');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@scope%2Fname',
      expect.any(Object) as object,
    );
    fetchSpy.mockRestore();
  });

  it('bootstrap-paradox check: 200 means package exists, not a bootstrap case', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"name":"demo-npm"}', { status: 200 }),
    );
    expect(await isBootstrapPublish('demo-npm')).toBe(false);
    fetchSpy.mockRestore();
  });

  it('bootstrap-paradox check: passes a 5s AbortSignal.timeout (#142)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    await isBootstrapPublish('demo-npm');
    const call = fetchSpy.mock.calls[0]!;
    const init = call[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // AbortSignal.timeout signals aren't aborted at construction time.
    expect(init.signal!.aborted).toBe(false);
    fetchSpy.mockRestore();
  });

  it('bootstrap-paradox check: timeout/network error falls through to false (#142)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        }),
      ),
    );
    expect(await isBootstrapPublish('demo-npm')).toBe(false);
    fetchSpy.mockRestore();
  });

  it('on auth-failure without OIDC, does not emit bootstrap hint (normal EAUTH path)', async () => {
    execMock
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('404'), { status: 1 });
      })
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('npm exit 1'), {
          stderr: Buffer.from('npm error code E401\nnpm error need auth'),
        });
      });
    process.env.NODE_AUTH_TOKEN = 'tok';
    await expect(
      npm.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, env: { NODE_AUTH_TOKEN: 'tok' } }),
      ),
    ).rejects.toThrow(/npm publish failed/);
  });

  it('on non-auth publish failure with OIDC on, does not emit bootstrap hint (non-auth fall-through)', async () => {
    execMock
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('404'), { status: 1 });
      })
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('npm exit 1'), {
          stderr: Buffer.from('ENETUNREACH: registry unreachable'),
        });
      });
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'oidc-present';
    await expect(
      npm.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, env: { ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-present' } }),
      ),
    ).rejects.toThrow(/ENETUNREACH|npm publish/);
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  });

  it('on publish failure with empty stderr, does not emit bootstrap hint', async () => {
    execMock
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('404'), { status: 1 });
      })
      .mockImplementationOnce(() => {
        // No stderr attached at all — looksLikeAuthFailure should bail early.
        throw new Error('opaque exit');
      });
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'oidc-present';
    await expect(
      npm.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, env: { ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-present' } }),
      ),
    ).rejects.toThrow(/npm publish failed/);
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  });

  it('on auth-failure with OIDC but package already exists on registry, does not emit bootstrap hint', async () => {
    execMock
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('404'), { status: 1 });
      })
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('npm exit 1'), {
          stderr: Buffer.from('npm error code E403'),
        });
      });
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"name":"demo-npm"}', { status: 200 }),
    );
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'oidc-present';
    await expect(
      npm.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, env: { ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-present' } }),
      ),
    ).rejects.toThrow(/npm publish failed/);
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    fetchSpy.mockRestore();
  });
});
