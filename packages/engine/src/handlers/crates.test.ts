/**
 * crates.io handler tests.
 *
 * Issue #16. Plan: §7.4, §13.1, §14.5, §16.1.
 *
 * Unit-suite isolation: the subprocess boundary (`node:child_process` — cargo
 * + git) and the filesystem (`node:fs`) are mocked so each case isolates the
 * unit under test. Cargo.toml contents are driven through `readFileSync`
 * returns; the dirty-tree scan is driven through mocked `git` output rather
 * than a real repo. Real end-to-end file + git behavior is covered by the
 * crates integration tier (tests/integration/crates.integration.test.ts).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { crates, looksLikeFirstPublishTpRejection, scanDirtyOutsideManifest } from './crates.js';
import type { Ctx } from '../types.js';

vi.mock('node:child_process');
vi.mock('node:fs');

const execMock = vi.mocked(execFileSync);
const readMock = vi.mocked(readFileSync);
const writeMock = vi.mocked(writeFileSync);

/** ENOENT the way `node:fs` throws it, so the handler's `code` branch fires. */
function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
}

/** The string content of the Nth `writeFileSync` call. */
function writtenContent(n = 0): string {
  return writeMock.mock.calls[n]![1] as string;
}

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

function basePkg(over: Partial<{ name: string; path: string; crate?: string }> = {}): Parameters<typeof crates.isPublished>[0] {
  return {
    name: 'demo-rust',
    kind: 'crates',
    path: '.',
    globs: ['**'],
    depends_on: [],
    first_version: '0.1.0',
    crate: 'demo-crate',
    ...over,
  };
}

const ENV_BAK = { ...process.env };

beforeEach(() => {
  execMock.mockReset();
  readMock.mockReset();
  writeMock.mockReset();
  delete process.env.CARGO_REGISTRY_TOKEN;
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ENV_BAK)) {delete process.env[k];}
  }
  Object.assign(process.env, ENV_BAK);
});

describe('crates.isPublished', () => {
  it('returns true on 200 from crates.io', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: { num: '0.1.0' } }), { status: 200 }),
    );
    const ok = await crates.isPublished(basePkg(), '0.1.0', makeCtx());
    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://crates.io/api/v1/crates/demo-crate/0.1.0',
      expect.objectContaining({ method: 'GET' }) as object,
    );
    fetchSpy.mockRestore();
  });

  it('returns false on 404', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    expect(await crates.isPublished(basePkg(), '0.1.0', makeCtx())).toBe(false);
    fetchSpy.mockRestore();
  });

  it('uses package.name when no explicit crate field', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    const pkg = basePkg();
    delete (pkg as { crate?: string }).crate;
    await crates.isPublished(pkg, '0.1.0', makeCtx());
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://crates.io/api/v1/crates/demo-rust/0.1.0',
      expect.any(Object) as object,
    );
    fetchSpy.mockRestore();
  });

  it('throws TransientError on 5xx', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 503 }),
    );
    await expect(crates.isPublished(basePkg(), '0.1.0', makeCtx())).rejects.toThrow(/transient|503/i);
    fetchSpy.mockRestore();
  });
});

describe('crates.latestVersion', () => {
  it('returns crate.newest_version on 200', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ crate: { newest_version: '1.4.2' } }), { status: 200 }),
    );
    expect(await crates.latestVersion(basePkg(), makeCtx())).toBe('1.4.2');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://crates.io/api/v1/crates/demo-crate',
      expect.objectContaining({ method: 'GET' }) as object,
    );
    fetchSpy.mockRestore();
  });

  it('returns null when the 200 body carries no newest_version', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ crate: {} }), { status: 200 }),
    );
    expect(await crates.latestVersion(basePkg(), makeCtx())).toBeNull();
    fetchSpy.mockRestore();
  });

  it('returns null on 404 (never published)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    expect(await crates.latestVersion(basePkg(), makeCtx())).toBeNull();
    fetchSpy.mockRestore();
  });

  it('throws TransientError on 5xx', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 503 }),
    );
    await expect(crates.latestVersion(basePkg(), makeCtx())).rejects.toThrow(/503/);
    fetchSpy.mockRestore();
  });
});

describe('crates.writeVersion', () => {
  const dir = '/wv';

  it('rewrites the [package] version in Cargo.toml', async () => {
    readMock.mockReturnValue(
      `[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde = "1"\n`,
    );
    const paths = await crates.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.3',
      makeCtx({ cwd: dir }),
    );
    const out = writtenContent();
    expect(out).toContain('version = "0.2.3"');
    expect(out).not.toContain('version = "0.1.0"');
    expect(out).toContain('name = "demo"');
    // The rewritten path is the package's Cargo.toml (separator-agnostic).
    expect(paths).toHaveLength(1);
    expect(paths[0]!.endsWith('Cargo.toml')).toBe(true);
  });

  it('is idempotent when version already matches', async () => {
    readMock.mockReturnValue(`[package]\nname = "demo"\nversion = "1.0.0"\n`);
    const paths = await crates.writeVersion(
      { ...basePkg(), path: dir },
      '1.0.0',
      makeCtx({ cwd: dir }),
    );
    expect(paths).toEqual([]);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('throws when Cargo.toml is missing', async () => {
    readMock.mockImplementation(() => {
      throw enoent();
    });
    await expect(
      crates.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir })),
    ).rejects.toThrow(/Cargo\.toml/);
  });

  it('throws when the [package] version line is missing', async () => {
    readMock.mockReturnValue(`[workspace]\nmembers = ["a"]\n`);
    await expect(
      crates.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir })),
    ).rejects.toThrow(/version/i);
  });

  it('preserves comments and whitespace around the version line', async () => {
    readMock.mockReturnValue(
      `[package]
name    = "demo"
# keep me
version = "0.1.0"   # trailing comment
edition = "2021"
`,
    );
    await crates.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.0',
      makeCtx({ cwd: dir }),
    );
    const out = writtenContent();
    expect(out).toContain('# keep me');
    expect(out).toContain('# trailing comment');
    expect(out).toContain('version = "0.2.0"');
  });
});

describe('crates.publish', () => {
  const dir = '/pub';

  it('skips when already published', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    const result = await crates.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir }),
    );
    expect(result.status).toBe('already-published');
    expect(execMock).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('runs cargo publish when not already published', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    // git → not a repo (scanDirty returns null); cargo → ok.
    execMock.mockImplementation((file: string) => {
      if (file === 'git') {throw new Error('not a git repo');}
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    const result = await crates.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    expect(result.status).toBe('published');
    expect(execMock).toHaveBeenCalledWith(
      'cargo',
      expect.arrayContaining(['publish', '--allow-dirty']) as string[],
      expect.any(Object) as object,
    );
    fetchSpy.mockRestore();
  });

  it('threads configured features into cargo publish (#169)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    // scanDirtyOutsideManifest spawns git several times before cargo; returning
    // null from the first rev-parse short-circuits that scan so only the
    // cargo invocation we care about lands in the mock calls list.
    execMock.mockImplementation((file: string) => {
      if (file === 'git') {throw new Error('not a git repo');}
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    await crates.publish(
      { ...basePkg(), path: dir, features: ['cli', 'serde'] },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const args = cargoCall![1] as string[];
    const idx = args.indexOf('--features');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('cli,serde');
    fetchSpy.mockRestore();
  });

  it('omits --features when the config has none (#169)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') {throw new Error('not a git repo');}
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    await crates.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const args = cargoCall![1] as string[];
    expect(args).not.toContain('--features');
    fetchSpy.mockRestore();
  });

  it('omits --features when the features list is empty (#169)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') {throw new Error('not a git repo');}
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    await crates.publish(
      { ...basePkg(), path: dir, features: [] },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const args = cargoCall![1] as string[];
    expect(args).not.toContain('--features');
    fetchSpy.mockRestore();
  });

  it('omits --no-default-features when the flag is undefined (#169 follow-up)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') {throw new Error('not a git repo');}
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    await crates.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const args = cargoCall![1] as string[];
    expect(args).not.toContain('--no-default-features');
    fetchSpy.mockRestore();
  });

  it('omits --no-default-features when the flag is false (#169 follow-up)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') {throw new Error('not a git repo');}
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    await crates.publish(
      { ...basePkg(), path: dir, no_default_features: false },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const args = cargoCall![1] as string[];
    expect(args).not.toContain('--no-default-features');
    fetchSpy.mockRestore();
  });

  it('includes --no-default-features when the flag is true (#169 follow-up)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') {throw new Error('not a git repo');}
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    await crates.publish(
      { ...basePkg(), path: dir, no_default_features: true },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const args = cargoCall![1] as string[];
    expect(args).toContain('--no-default-features');
    fetchSpy.mockRestore();
  });

  it('combines --features and --no-default-features in the right order (#169 follow-up)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') {throw new Error('not a git repo');}
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    await crates.publish(
      { ...basePkg(), path: dir, features: ['cli', 'serde'], no_default_features: true },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const args = cargoCall![1] as string[];
    const featuresIdx = args.indexOf('--features');
    const noDefaultIdx = args.indexOf('--no-default-features');
    expect(featuresIdx).toBeGreaterThanOrEqual(0);
    expect(args[featuresIdx + 1]).toBe('cli,serde');
    expect(noDefaultIdx).toBeGreaterThan(featuresIdx);
    fetchSpy.mockRestore();
  });

  it('passes a minimal env to cargo (#138): includes PATH, excludes unrelated parent secrets', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') {throw new Error('not a git repo');}
      return Buffer.from('ok');
    });
    process.env.UNRELATED_AWS_SECRET = 'parent-leak-should-not-ship';
    process.env.PATH = process.env.PATH ?? '/usr/bin';

    await crates.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'ship-this-one' } }),
    );

    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const envSpec = (cargoCall![2] as { env: Record<string, string> }).env;
    // ctx.env is forwarded (declared passthrough).
    expect(envSpec.CARGO_REGISTRY_TOKEN).toBe('ship-this-one');
    // Explicit extra set by the handler.
    expect(envSpec.CARGO_TERM_VERBOSE).toBe('true');
    // PATH stays so cargo can be found.
    expect(envSpec.PATH).toBe(process.env.PATH);
    // Unrelated parent secret is dropped.
    expect(envSpec.UNRELATED_AWS_SECRET).toBeUndefined();

    delete process.env.UNRELATED_AWS_SECRET;
    fetchSpy.mockRestore();
  });

  describe('alt-registry fallback (#331)', () => {
    function expectCargoPublish(
      args: readonly string[],
      flag: string,
    ): string | undefined {
      const idx = args.indexOf(flag);
      return idx >= 0 ? args[idx + 1] : undefined;
    }

    it('retries against PIOT_CRATES_REGISTRY_FALLBACK on a 429 from real crates.io', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      let cargoCalls = 0;
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {throw new Error('not a git repo');}
        cargoCalls += 1;
        if (cargoCalls === 1) {
          throw Object.assign(new Error('exit 1'), {
            stderr: Buffer.from(
              'error: failed to publish demo-crate v0.1.0 to registry at https://crates.io\n\n' +
                'Caused by:\n' +
                '  the remote server responded with an error (status 429 Too Many Requests):\n' +
                '  You have published too many versions of this crate in the last 24 hours\n',
            ),
          });
        }
        return Buffer.from('ok');
      });
      process.env.CARGO_REGISTRY_TOKEN = 'tok';

      const result = await crates.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({
          cwd: dir,
          env: {
            CARGO_REGISTRY_TOKEN: 'tok',
            PIOT_CRATES_REGISTRY_FALLBACK: 'http://localhost:8000',
          },
        }),
      );

      expect(result.status).toBe('published');
      const cargoInvocations = execMock.mock.calls.filter((c) => c[0] === 'cargo');
      expect(cargoInvocations).toHaveLength(2);
      // First call is the steady-state attempt; no --index flag (real crates.io).
      const firstArgs = cargoInvocations[0]![1] as string[];
      expect(firstArgs).not.toContain('--index');
      // Second call is the fallback; routes at the fallback URL via --index.
      const secondArgs = cargoInvocations[1]![1] as string[];
      expect(expectCargoPublish(secondArgs, '--index')).toBe('http://localhost:8000');
      fetchSpy.mockRestore();
    });

    it('emits a ::warning:: workflow command when the fallback engages', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      let cargoCalls = 0;
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {throw new Error('not a git repo');}
        cargoCalls += 1;
        if (cargoCalls === 1) {
          throw Object.assign(new Error('exit 1'), {
            stderr: Buffer.from('status 429 Too Many Requests\nrate-limited'),
          });
        }
        return Buffer.from('ok');
      });
      const writes: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(
        (chunk: string | Uint8Array): boolean => {
          writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
          return true;
        },
      );
      process.env.CARGO_REGISTRY_TOKEN = 'tok';

      await crates.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({
          cwd: dir,
          env: {
            CARGO_REGISTRY_TOKEN: 'tok',
            PIOT_CRATES_REGISTRY_FALLBACK: 'http://localhost:8000',
          },
        }),
      );

      const joined = writes.join('');
      expect(joined).toMatch(/::warning::/);
      expect(joined).toContain('http://localhost:8000');
      stdoutSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('does NOT retry on 429 when PIOT_CRATES_REGISTRY_FALLBACK is unset (consumer prod path unchanged)', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {throw new Error('not a git repo');}
        throw Object.assign(new Error('exit 1'), {
          stderr: Buffer.from('status 429 Too Many Requests'),
        });
      });
      process.env.CARGO_REGISTRY_TOKEN = 'tok';

      await expect(
        crates.publish(
          { ...basePkg(), path: dir },
          '0.1.0',
          makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'tok' } }),
        ),
      ).rejects.toThrow(/429|Too Many Requests/);
      const cargoInvocations = execMock.mock.calls.filter((c) => c[0] === 'cargo');
      expect(cargoInvocations).toHaveLength(1);
      fetchSpy.mockRestore();
    });

    it('does NOT retry on non-429 failures even when PIOT_CRATES_REGISTRY_FALLBACK is set', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {throw new Error('not a git repo');}
        throw Object.assign(new Error('exit 1'), {
          stderr: Buffer.from('error: authentication required'),
        });
      });
      process.env.CARGO_REGISTRY_TOKEN = 'tok';

      await expect(
        crates.publish(
          { ...basePkg(), path: dir },
          '0.1.0',
          makeCtx({
            cwd: dir,
            env: {
              CARGO_REGISTRY_TOKEN: 'tok',
              PIOT_CRATES_REGISTRY_FALLBACK: 'http://localhost:8000',
            },
          }),
        ),
      ).rejects.toThrow(/authentication required|cargo publish/);
      const cargoInvocations = execMock.mock.calls.filter((c) => c[0] === 'cargo');
      expect(cargoInvocations).toHaveLength(1);
      fetchSpy.mockRestore();
    });

    it('routes publish at PIOT_CRATES_REGISTRY_PRIMARY when set (no real-crates.io attempt, no fallback)', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {throw new Error('not a git repo');}
        return Buffer.from('ok');
      });
      process.env.CARGO_REGISTRY_TOKEN = 'tok';

      const result = await crates.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({
          cwd: dir,
          env: {
            CARGO_REGISTRY_TOKEN: 'tok',
            PIOT_CRATES_REGISTRY_PRIMARY: 'http://localhost:8000',
            PIOT_CRATES_REGISTRY_FALLBACK: 'http://localhost:8000',
          },
        }),
      );

      expect(result.status).toBe('published');
      const cargoInvocations = execMock.mock.calls.filter((c) => c[0] === 'cargo');
      expect(cargoInvocations).toHaveLength(1);
      const args = cargoInvocations[0]![1] as string[];
      expect(expectCargoPublish(args, '--index')).toBe('http://localhost:8000');
      fetchSpy.mockRestore();
    });

    it('does NOT retry on 429 when PIOT_CRATES_REGISTRY_PRIMARY is set (primary is authoritative)', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {throw new Error('not a git repo');}
        throw Object.assign(new Error('exit 1'), {
          stderr: Buffer.from('status 429 Too Many Requests'),
        });
      });
      process.env.CARGO_REGISTRY_TOKEN = 'tok';

      await expect(
        crates.publish(
          { ...basePkg(), path: dir },
          '0.1.0',
          makeCtx({
            cwd: dir,
            env: {
              CARGO_REGISTRY_TOKEN: 'tok',
              PIOT_CRATES_REGISTRY_PRIMARY: 'http://localhost:8000',
              PIOT_CRATES_REGISTRY_FALLBACK: 'http://localhost:8000',
            },
          }),
        ),
      ).rejects.toThrow(/429|Too Many Requests/);
      const cargoInvocations = execMock.mock.calls.filter((c) => c[0] === 'cargo');
      expect(cargoInvocations).toHaveLength(1);
      fetchSpy.mockRestore();
    });
  });

  it('reports cargo publish failure', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') {throw new Error('not a git repo');}
      throw Object.assign(new Error('exit 1'), { stderr: Buffer.from('permission denied') });
    });
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    await expect(
      crates.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'tok' } }),
      ),
    ).rejects.toThrow(/cargo publish|exit 1|permission denied/i);
    fetchSpy.mockRestore();
  });

  describe('first-publish TP rejection (#284)', () => {
    const STDERR = [
      'error: failed to publish to registry at https://crates.io',
      '',
      'Caused by:',
      '  the remote server responded with an error (status 404 Not Found): Crate `demo-crate` does not exist or you do not have permission to publish to it. Trusted publishing requires the crate to already exist.',
    ].join('\n');

    it('surfaces PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED with the bootstrap-token hint', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {throw new Error('not a git repo');}
        throw Object.assign(new Error('exit 1'), { stderr: Buffer.from(STDERR) });
      });
      process.env.CARGO_REGISTRY_TOKEN = 'tok';

      await expect(
        crates.publish(
          { ...basePkg(), path: dir },
          '0.1.0',
          makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'tok' } }),
        ),
      ).rejects.toThrow(/PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED/);
      // And the hint names CARGO_REGISTRY_TOKEN as the bootstrap path,
      // names the crate, and preserves cargo's full stderr block at the
      // tail for debuggability.
      let captured: unknown;
      try {
        await crates.publish(
          { ...basePkg(), path: dir },
          '0.1.0',
          makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'tok' } }),
        );
      } catch (err) {
        captured = err;
      }
      const msg = (captured as Error).message;
      expect(msg).toMatch(/CARGO_REGISTRY_TOKEN/);
      expect(msg).toMatch(/demo-crate/);
      expect(msg).toMatch(/--- cargo stderr ---/);
      expect(msg).toMatch(/status 404 Not Found/);
      fetchSpy.mockRestore();
    });

    it('does NOT misfire on the generic cargo failure stderr shape', async () => {
      // The bootstrap-hint detector must be specific: a generic compile
      // failure (no 404 status, no TP-specific prose) falls through to
      // the existing `cargo publish failed` message.
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {throw new Error('not a git repo');}
        throw Object.assign(new Error('exit 1'), {
          stderr: Buffer.from('error: could not compile `demo-crate` due to previous error'),
        });
      });
      process.env.CARGO_REGISTRY_TOKEN = 'tok';

      await expect(
        crates.publish(
          { ...basePkg(), path: dir },
          '0.1.0',
          makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'tok' } }),
        ),
      ).rejects.toThrow(/cargo publish failed/);
      await expect(
        crates.publish(
          { ...basePkg(), path: dir },
          '0.1.0',
          makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'tok' } }),
        ),
      ).rejects.not.toThrow(/PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED/);
      fetchSpy.mockRestore();
    });

    it('is suppressed under the PIOT_CRATES_REGISTRY_PRIMARY e2e seam', async () => {
      // The alt-registry isn't TP-aware, so a 404 there is a different
      // bug — surfacing the bootstrap hint would mislead. Confirm the
      // detector stays quiet when the primary-override is in effect
      // even if the stderr shape would otherwise match.
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {throw new Error('not a git repo');}
        throw Object.assign(new Error('exit 1'), { stderr: Buffer.from(STDERR) });
      });
      process.env.CARGO_REGISTRY_TOKEN = 'tok';

      await expect(
        crates.publish(
          { ...basePkg(), path: dir },
          '0.1.0',
          makeCtx({
            cwd: dir,
            env: {
              CARGO_REGISTRY_TOKEN: 'tok',
              PIOT_CRATES_REGISTRY_PRIMARY: 'http://localhost:8000',
            },
          }),
        ),
      ).rejects.not.toThrow(/PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED/);
      fetchSpy.mockRestore();
    });
  });
});

describe('looksLikeFirstPublishTpRejection (#284)', () => {
  it('matches the canonical 404 + "crate does not exist" stderr', () => {
    const stderr = [
      'error: failed to publish to registry at https://crates.io',
      'Caused by:',
      '  the remote server responded with an error (status 404 Not Found): Crate `demo-crate` does not exist or you do not have permission to publish to it.',
    ].join('\n');
    expect(looksLikeFirstPublishTpRejection(stderr)).toBe(true);
  });

  it('matches when the 404 line and a "trusted publish" mention co-occur', () => {
    const stderr = [
      'status 404 Not Found',
      'Trusted publishing requires the crate to already exist.',
    ].join('\n');
    expect(looksLikeFirstPublishTpRejection(stderr)).toBe(true);
  });

  it('rejects when only one anchor is present (404 without the prose)', () => {
    expect(
      looksLikeFirstPublishTpRejection(
        'status 404 Not Found\nsome unrelated error about a missing index file',
      ),
    ).toBe(false);
  });

  it('rejects when only one anchor is present (prose without the 404)', () => {
    expect(
      looksLikeFirstPublishTpRejection(
        'crate `demo-crate` does not exist — but this is a dependency error, not a 4xx',
      ),
    ).toBe(false);
  });

  it('rejects on an unrelated 429 rate-limit stderr', () => {
    expect(
      looksLikeFirstPublishTpRejection(
        'status 429 Too Many Requests\nYou have published too many versions of this crate in the last 24 hours',
      ),
    ).toBe(false);
  });

  it('rejects an undefined stderr (defensive)', () => {
    expect(looksLikeFirstPublishTpRejection(undefined)).toBe(false);
  });
});

describe('scanDirtyOutsideManifest (#135)', () => {
  // The git subprocess is mocked: `rev-parse --show-toplevel` establishes the
  // worktree, `ls-files` reports the managed Cargo.toml's repo-relative path,
  // and `status --porcelain` supplies the dirty set. porcelain paths are
  // forward-slashed (git renders them that way on every platform).
  interface GitRoutes {
    /** When true, `git rev-parse --show-toplevel` throws (not a worktree). */
    noRepo?: boolean;
    toplevel?: string;
    managedRel?: string;
    porcelain?: string;
  }

  function mockGit(routes: GitRoutes): void {
    execMock.mockImplementation((file: string, args?: readonly string[]) => {
      if (file !== 'git') {throw new Error(`unexpected exec: ${file}`);}
      const a = (args ?? []) as string[];
      if (a[0] === 'rev-parse') {
        if (routes.noRepo) {throw new Error('not a git repo');}
        return `${routes.toplevel ?? '/repo'}\n`;
      }
      if (a[0] === 'ls-files') {return `${routes.managedRel ?? ''}\n`;}
      if (a[0] === 'status') {return routes.porcelain ?? '';}
      throw new Error(`unexpected git: ${a.join(' ')}`);
    });
  }

  it('returns an empty list when only the managed Cargo.toml is dirty', () => {
    mockGit({ managedRel: 'Cargo.toml', porcelain: ' M Cargo.toml\n' });
    expect(scanDirtyOutsideManifest('/repo', '/repo')).toEqual([]);
  });

  it('flags a stray dirty file outside the package dir', () => {
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n M README.md\n',
    });
    const result = scanDirtyOutsideManifest('/repo', '/repo/crate');
    expect(result).toContain('README.md');
    expect(result).not.toContain('crate/Cargo.toml');
  });

  it('flags a dirty sibling file inside the package dir that is not Cargo.toml', () => {
    // Only src/lib.rs dirty -- the managed Cargo.toml is unchanged. Still
    // a surprise: our writeVersion didn't produce this edit.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/src/lib.rs\n',
    });
    const result = scanDirtyOutsideManifest('/repo', '/repo/crate');
    expect(result).toContain('crate/src/lib.rs');
  });

  it('skips files under artifactsRoot — engine-managed scratch (#244)', () => {
    // The reusable workflow's `actions/download-artifact@v4` step always
    // creates `artifacts/` under cwd, even when nothing was uploaded
    // (crates-only fixtures). git status sees `?? artifacts/` and the
    // pre-publish dirty-check would refuse cargo publish unless it
    // recognises this directory as engine-managed.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n?? artifacts/\n',
    });
    const result = scanDirtyOutsideManifest('/repo', '/repo/crate', '/repo/artifacts');
    expect(result).toEqual([]);
  });

  it('still flags non-artifacts-root files when artifactsRoot is provided', () => {
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n M README.md\n?? artifacts/file.txt\n',
    });
    const result = scanDirtyOutsideManifest('/repo', '/repo/crate', '/repo/artifacts');
    expect(result).toContain('README.md');
    expect(result?.some((p) => p.startsWith('artifacts'))).toBe(false);
  });

  it('returns null when cwd is not inside a git worktree', () => {
    mockGit({ noRepo: true });
    expect(scanDirtyOutsideManifest('/plain', '/plain')).toBeNull();
  });

  it('skips files inside sibling package paths — workflow-managed install state', () => {
    // Polyglot setup: rust crate at packages/rust/, npm package at
    // packages/ts/. The reusable workflow's `Build npm packages` step
    // creates packages/ts/{node_modules,dist,package-lock.json} as
    // untracked files before cargo publish runs. None of that can end
    // up in the rust crate's tarball — cargo only packs from
    // packages/rust/ — so the dirty check shouldn't refuse on them.
    mockGit({
      managedRel: 'packages/rust/Cargo.toml',
      porcelain: [
        ' M packages/rust/Cargo.toml',
        '?? packages/ts/node_modules/typescript/bin/tsc',
        '?? packages/ts/package-lock.json',
        '?? packages/ts/dist/index.js',
        '',
      ].join('\n'),
    });
    const result = scanDirtyOutsideManifest(
      '/repo',
      '/repo/packages/rust',
      undefined,
      ['/repo/packages/ts'],
    );
    expect(result).toEqual([]);
  });

  it('still flags non-sibling paths when siblingPackagePaths is provided', () => {
    mockGit({
      managedRel: 'packages/rust/Cargo.toml',
      porcelain: [
        ' M packages/rust/Cargo.toml',
        ' M README.md',
        '?? packages/ts/dist',
        '',
      ].join('\n'),
    });
    const result = scanDirtyOutsideManifest(
      '/repo',
      '/repo/packages/rust',
      undefined,
      ['/repo/packages/ts'],
    );
    expect(result).toContain('README.md');
    expect(result?.some((p) => p.startsWith('packages/ts'))).toBe(false);
  });

  it('crates.publish rejects with a clear error when an unrelated file is dirty', async () => {
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n M README.md\n',
    });
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    await expect(
      crates.publish(
        { ...basePkg(), path: '/repo/crate' },
        '0.2.0',
        makeCtx({ cwd: '/repo', env: { CARGO_REGISTRY_TOKEN: 'tok' } }),
      ),
    ).rejects.toThrow(/unexpected dirty|README\.md/);
    fetchSpy.mockRestore();
  });
});
