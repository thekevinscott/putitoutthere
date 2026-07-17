/**
 * crates.io handler tests.
 *
 * Issue #16. Plan: §7.4, §13.1, §14.5, §16.1.
 *
 * Unit-suite isolation: the subprocess boundary (the process seam —
 * `execCapture`, driving cargo + git) and the filesystem
 * (`node:fs/promises`) are mocked so each case isolates the unit under
 * test. Cargo.toml contents are driven through `readFile` resolutions;
 * the dirty-tree scan is driven through mocked `git` output rather than a
 * real repo. Real end-to-end file + git behavior is covered by the crates
 * integration tier (tests/integration/crates.integration.test.ts).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture, type ExecResult } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';

vi.mock('../utils/exec-error.js', async () => await vi.importActual<typeof import('../utils/exec-error.js')>('../utils/exec-error.js'));
import {
  crates,
  looksLikeFirstPublishTpRejection,
  relativeOrSelf,
  scanDirtyOutsideManifest,
} from './crates.js';
import type { Ctx } from '../types.js';

vi.mock('../utils/exec-capture.js');
vi.mock('node:fs/promises');

const execMock = vi.mocked(execCapture);
const readMock = vi.mocked(readFile);
const writeMock = vi.mocked(writeFile);

/** A resolved `execCapture` result carrying `stdout`. */
function ok(stdout: string): ExecResult {
  return { stdout, stderr: '' };
}

/** ENOENT the way `node:fs/promises` rejects it, so the handler's `code` branch fires. */
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

  it('throws a plain Error on an unexpected 4xx (defensive fallthrough)', async () => {
    // crates.io returns 200/404 for this endpoint; a bare 4xx (not 404, not
    // 5xx) is not retriable, so it surfaces as a plain Error rather than a
    // TransientError. Exercises the else-path of the `>= 500` guard.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 400 }),
    );
    await expect(crates.isPublished(basePkg(), '0.1.0', makeCtx())).rejects.toThrow(
      /returned 400/,
    );
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

describe('crates.trustPosture (#414)', () => {
  it('returns "oidc" when the version carries trustpub_data', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ version: { trustpub_data: { provider: 'github', repository: 'acme/demo' } } }),
        { status: 200 },
      ),
    );
    expect(await crates.trustPosture(basePkg(), '0.1.0', makeCtx())).toBe('oidc');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://crates.io/api/v1/crates/demo-crate/0.1.0',
      expect.objectContaining({ method: 'GET' }) as object,
    );
    fetchSpy.mockRestore();
  });

  it('returns "token" when the version has no trustpub_data', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: {} }), { status: 200 }),
    );
    expect(await crates.trustPosture(basePkg(), '0.1.0', makeCtx())).toBe('token');
    fetchSpy.mockRestore();
  });

  it('returns "token" when the body carries no version object (optional chain)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    expect(await crates.trustPosture(basePkg(), '0.1.0', makeCtx())).toBe('token');
    fetchSpy.mockRestore();
  });

  it('throws TransientError on any non-200', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 503 }),
    );
    await expect(crates.trustPosture(basePkg(), '0.1.0', makeCtx())).rejects.toThrow(/503/);
    fetchSpy.mockRestore();
  });
});

describe('crates.writeVersion', () => {
  const dir = '/wv';

  it('rewrites the [package] version in Cargo.toml', async () => {
    readMock.mockResolvedValue(
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
    // The manifest is read and rewritten as utf8 text.
    expect(readMock).toHaveBeenCalledWith(expect.stringContaining('Cargo.toml'), 'utf8');
    expect(writeMock).toHaveBeenCalledWith(expect.stringContaining('Cargo.toml'), expect.anything(), 'utf8');
    // The rewritten path is the package's Cargo.toml (separator-agnostic).
    expect(paths).toHaveLength(1);
    expect(paths[0]!.endsWith('Cargo.toml')).toBe(true);
  });

  it('is idempotent when version already matches', async () => {
    readMock.mockResolvedValue(`[package]\nname = "demo"\nversion = "1.0.0"\n`);
    const paths = await crates.writeVersion(
      { ...basePkg(), path: dir },
      '1.0.0',
      makeCtx({ cwd: dir }),
    );
    expect(paths).toEqual([]);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('throws when Cargo.toml is missing, chaining the ENOENT as the cause', async () => {
    const missing = enoent();
    readMock.mockRejectedValue(missing);
    const err = await crates
      .writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir }))
      .catch((e: unknown) => e as Error) as Error;
    expect(err.message).toMatch(/Cargo\.toml/);
    // The original ENOENT is preserved as `cause` (not dropped).
    expect(err.cause).toBe(missing);
  });

  it('surfaces a non-ENOENT read error as-is (perms/io)', async () => {
    // A read failure that is NOT "file missing" (e.g. EACCES) exercises the
    // else-path of the ENOENT check: the original error is re-surfaced
    // rather than remapped to the "Cargo.toml not found" message.
    readMock.mockImplementation(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    await expect(
      crates.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir })),
    ).rejects.toThrow(/EACCES: permission denied/);
  });

  it('re-surfaces the original Error instance on a non-ENOENT read failure (toError passthrough identity)', async () => {
    // toError()'s Error arm is a passthrough, not a re-wrap: the exact
    // instance thrown by the read must reach the caller (stack, class, and
    // any attached props intact). A wrapped copy with a matching message
    // would satisfy the /EACCES/ test above but break this one.
    const sentinel = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    readMock.mockImplementation(() => {
      throw sentinel;
    });
    const err: unknown = await crates
      .writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir }))
      .catch((e: unknown) => e);
    expect(err).toBe(sentinel);
  });

  it('wraps a non-Error read failure in an Error (String(err) fallback)', async () => {
    // A thrown non-Error value (no `.code`, not an `instanceof Error`) skips
    // the ENOENT remap and hits the `new Error(String(err))` branch.
    readMock.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error to hit the String(err) branch
      throw 'disk gremlins';
    });
    await expect(
      crates.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir })),
    ).rejects.toThrow(/disk gremlins/);
  });

  it('throws when the [package] version line is missing', async () => {
    readMock.mockResolvedValue(`[workspace]\nmembers = ["a"]\n`);
    await expect(
      crates.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir })),
    ).rejects.toThrow(/version/i);
  });

  it('preserves comments and whitespace around the version line', async () => {
    readMock.mockResolvedValue(
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
      if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
      return Promise.resolve(ok('ok'));
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
      if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
      return Promise.resolve(ok('ok'));
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
      if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
      return Promise.resolve(ok('ok'));
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
      if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
      return Promise.resolve(ok('ok'));
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
      if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
      return Promise.resolve(ok('ok'));
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
      if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
      return Promise.resolve(ok('ok'));
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
      if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
      return Promise.resolve(ok('ok'));
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
      if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
      return Promise.resolve(ok('ok'));
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
      if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
      return Promise.resolve(ok('ok'));
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
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        cargoCalls += 1;
        if (cargoCalls === 1) {
          return Promise.reject(
            new ExecError(
              'exit 1',
              '',
              'error: failed to publish demo-crate v0.1.0 to registry at https://crates.io\n\n' +
                'Caused by:\n' +
                '  the remote server responded with an error (status 429 Too Many Requests):\n' +
                '  You have published too many versions of this crate in the last 24 hours\n',
              1,
            ),
          );
        }
        return Promise.resolve(ok('ok'));
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
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        cargoCalls += 1;
        if (cargoCalls === 1) {
          return Promise.reject(
            new ExecError('exit 1', '', 'status 429 Too Many Requests\nrate-limited', 1),
          );
        }
        return Promise.resolve(ok('ok'));
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
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        return Promise.reject(new ExecError('exit 1', '', 'status 429 Too Many Requests', 1));
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
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        return Promise.reject(new ExecError('exit 1', '', 'error: authentication required', 1));
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

    it('trims surrounding whitespace from cargo stderr in the generic failure message (#469)', async () => {
      // The generic (non-429, non-first-publish) failure interpolates cargo's
      // stderr into the thrown message; it must be trimmed, not raw.
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        return Promise.reject(new ExecError('exit 1', '', '\n  boom: build failed  \n', 1));
      });
      process.env.CARGO_REGISTRY_TOKEN = 'tok';
      const err = await crates
        .publish(
          { ...basePkg(), path: dir },
          '0.1.0',
          makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'tok' } }),
        )
        .catch((e: unknown) => e as Error) as Error;
      expect(err.message).toBe('cargo publish failed:\nboom: build failed');
      fetchSpy.mockRestore();
    });

    it('trims surrounding whitespace from cargo stderr in the fallback failure message (#469)', async () => {
      // Primary 429 engages the fallback; the fallback also fails, and its
      // stderr is interpolated into the thrown message — trimmed, not raw.
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      let cargoCalls = 0;
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        cargoCalls += 1;
        if (cargoCalls === 1) {
          return Promise.reject(new ExecError('exit 1', '', 'status 429 Too Many Requests', 1));
        }
        return Promise.reject(new ExecError('exit 1', '', '\n  fallback boom  \n', 1));
      });
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((): boolean => true);
      process.env.CARGO_REGISTRY_TOKEN = 'tok';
      const err = await crates
        .publish(
          { ...basePkg(), path: dir },
          '0.1.0',
          makeCtx({
            cwd: dir,
            env: {
              CARGO_REGISTRY_TOKEN: 'tok',
              PIOT_CRATES_REGISTRY_FALLBACK: 'http://localhost:8000',
            },
          }),
        )
        .catch((e: unknown) => e as Error) as Error;
      expect(err.message).toBe(
        'cargo publish (fallback http://localhost:8000) failed:\nfallback boom',
      );
      stdoutSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('routes publish at PIOT_CRATES_REGISTRY_PRIMARY when set (no real-crates.io attempt, no fallback)', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        return Promise.resolve(ok('ok'));
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
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        return Promise.reject(new ExecError('exit 1', '', 'status 429 Too Many Requests', 1));
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

    it('surfaces the fallback failure (with stderr) when the retry against the fallback also fails', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      let cargoCalls = 0;
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        cargoCalls += 1;
        if (cargoCalls === 1) {
          // Primary crates.io 429 → engages the fallback.
          return Promise.reject(
            new ExecError('exit 1', '', 'status 429 Too Many Requests', 1),
          );
        }
        // The fallback registry also errors — an ExecError carrying stderr.
        return Promise.reject(new ExecError('exit 7', '', 'fallback registry down', 7));
      });
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((): boolean => true);
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
      ).rejects.toThrow(/fallback http:\/\/localhost:8000.*fallback registry down/s);
      stdoutSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('surfaces the fallback failure using String(err) when the retry throws a non-Error with no stderr', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      let cargoCalls = 0;
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        cargoCalls += 1;
        if (cargoCalls === 1) {
          return Promise.reject(
            new ExecError('exit 1', '', 'status 429 Too Many Requests', 1),
          );
        }
        // Non-Error, no stderr — exercises the String(retryErr) fallback and
        // the "no retry stderr" message branch.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately non-Error to hit the String(err) branch
        return Promise.reject('catastrophic fallback failure');
      });
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((): boolean => true);
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
      ).rejects.toThrow(/fallback http:\/\/localhost:8000\) failed: catastrophic fallback failure/);
      stdoutSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('reports a non-Error cargo failure with no stderr via String(err) (fallback provisioned, not rate-limited)', async () => {
      // Primary cargo throws a non-Error with no stderr. With a fallback
      // provisioned, isRateLimited(undefined) is exercised (returns false via
      // its empty-stderr guard), the TP-rejection detector declines, and the
      // generic failure message falls back to String(err).
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {throw new Error('not a git repo');}
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error to hit the String(err) branch
        throw 'plain string failure';
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
      ).rejects.toThrow(/cargo publish failed: plain string failure/);
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
      if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
      return Promise.reject(new ExecError('exit 1', '', 'permission denied', 1));
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
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        return Promise.reject(new ExecError('exit 1', '', STDERR, 1));
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
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        return Promise.reject(
          new ExecError('exit 1', '', 'error: could not compile `demo-crate` due to previous error', 1),
        );
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
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        return Promise.reject(new ExecError('exit 1', '', STDERR, 1));
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
    /** When true, `git ls-files -- Cargo.toml` throws (Cargo.toml untracked). */
    lsFilesThrows?: boolean;
    /** When true, `git status --porcelain` throws after rev-parse succeeded. */
    statusThrows?: boolean;
  }

  function mockGit(routes: GitRoutes): void {
    execMock.mockImplementation((file: string, args?: readonly string[]) => {
      if (file !== 'git') {return Promise.reject(new ExecError(`unexpected exec: ${file}`, '', '', null));}
      const a = (args ?? []) as string[];
      if (a[0] === 'rev-parse') {
        if (routes.noRepo) {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        return Promise.resolve(ok(`${routes.toplevel ?? '/repo'}\n`));
      }
      if (a[0] === 'ls-files') {
        if (routes.lsFilesThrows) {return Promise.reject(new ExecError('not in index', '', '', 1));}
        return Promise.resolve(ok(`${routes.managedRel ?? ''}\n`));
      }
      if (a[0] === 'status') {
        if (routes.statusThrows) {return Promise.reject(new ExecError('status failed', '', '', 128));}
        return Promise.resolve(ok(routes.porcelain ?? ''));
      }
      return Promise.reject(new ExecError(`unexpected git: ${a.join(' ')}`, '', '', null));
    });
  }

  it('returns an empty list when only the managed Cargo.toml is dirty', async () => {
    mockGit({ managedRel: 'Cargo.toml', porcelain: ' M Cargo.toml\n' });
    expect(await scanDirtyOutsideManifest('/repo', '/repo')).toEqual([]);
    // The three git probes run with their exact argv + cwd scoping.
    expect(execMock).toHaveBeenCalledWith('git', ['rev-parse', '--show-toplevel'], { cwd: '/repo' });
    expect(execMock).toHaveBeenCalledWith(
      'git',
      ['ls-files', '--full-name', '--', 'Cargo.toml'],
      { cwd: '/repo' },
    );
    expect(execMock).toHaveBeenCalledWith('git', ['status', '--porcelain'], { cwd: '/repo' });
  });

  it('flags a stray dirty file outside the package dir', async () => {
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n M README.md\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate');
    expect(result).toContain('README.md');
    expect(result).not.toContain('crate/Cargo.toml');
  });

  it('flags a dirty sibling file inside the package dir that is not Cargo.toml', async () => {
    // Only src/lib.rs dirty -- the managed Cargo.toml is unchanged. Still
    // a surprise: our writeVersion didn't produce this edit.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/src/lib.rs\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate');
    expect(result).toContain('crate/src/lib.rs');
  });

  it('skips files under artifactsRoot — engine-managed scratch (#244)', async () => {
    // The reusable workflow's `actions/download-artifact@v4` step always
    // creates `artifacts/` under cwd, even when nothing was uploaded
    // (crates-only fixtures). git status sees `?? artifacts/` and the
    // pre-publish dirty-check would refuse cargo publish unless it
    // recognises this directory as engine-managed.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n?? artifacts/\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate', '/repo/artifacts');
    expect(result).toEqual([]);
  });

  it('still flags non-artifacts-root files when artifactsRoot is provided', async () => {
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n M README.md\n?? artifacts/file.txt\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate', '/repo/artifacts');
    expect(result).toContain('README.md');
    expect(result?.some((p) => p.startsWith('artifacts'))).toBe(false);
  });

  it('returns null when cwd is not inside a git worktree', async () => {
    mockGit({ noRepo: true });
    expect(await scanDirtyOutsideManifest('/plain', '/plain')).toBeNull();
  });

  it('returns null when git reports an empty toplevel', async () => {
    // rev-parse succeeds but prints only whitespace — treat as "can't
    // verify" and fall through to cargo's own --allow-dirty behavior.
    mockGit({ toplevel: '' });
    expect(await scanDirtyOutsideManifest('/repo', '/repo')).toBeNull();
  });

  it('treats every dirty file as unexpected when Cargo.toml is untracked', async () => {
    // Fresh tree, first release: `git ls-files -- Cargo.toml` fails because
    // the manifest is not yet in the index. managedRel stays empty, so nothing
    // is exempted — even a dirty Cargo.toml is flagged, refusing the publish
    // rather than silently packing an unexpected edit.
    mockGit({ lsFilesThrows: true, porcelain: ' M crate/Cargo.toml\n' });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate');
    expect(result).toContain('crate/Cargo.toml');
  });

  it('returns null when git status fails after rev-parse succeeded', async () => {
    // rev-parse established the worktree, but the porcelain read then errors
    // (e.g. a mid-run index lock). Bail to null and let cargo's own
    // --allow-dirty handling take over rather than crashing the publish.
    mockGit({ managedRel: 'crate/Cargo.toml', statusThrows: true });
    expect(await scanDirtyOutsideManifest('/repo', '/repo/crate')).toBeNull();
  });

  it('handles artifactsRoot equal to cwd (empty relative path)', async () => {
    // relative(cwd, artifactsRoot) === '' when they are the same dir; the
    // artifacts-skip is then disabled (empty prefix), so stray files still
    // surface.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n M README.md\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate', '/repo');
    expect(result).toContain('README.md');
  });

  it('skips sibling paths that equal cwd or resolve outside the worktree', async () => {
    // A sibling equal to cwd (relative === '') and a sibling outside cwd
    // (relative starts with '..') are both skipped by the guard, leaving
    // only genuine strays flagged.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n M README.md\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate', undefined, [
      '/repo',
      '/outside',
    ]);
    expect(result).toContain('README.md');
  });

  it('skips files inside sibling package paths — workflow-managed install state', async () => {
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
    const result = await scanDirtyOutsideManifest(
      '/repo',
      '/repo/packages/rust',
      undefined,
      ['/repo/packages/ts'],
    );
    expect(result).toEqual([]);
  });

  it('still flags non-sibling paths when siblingPackagePaths is provided', async () => {
    mockGit({
      managedRel: 'packages/rust/Cargo.toml',
      porcelain: [
        ' M packages/rust/Cargo.toml',
        ' M README.md',
        '?? packages/ts/dist',
        '',
      ].join('\n'),
    });
    const result = await scanDirtyOutsideManifest(
      '/repo',
      '/repo/packages/rust',
      undefined,
      ['/repo/packages/ts'],
    );
    expect(result).toContain('README.md');
    expect(result?.some((p) => p.startsWith('packages/ts'))).toBe(false);
  });

  it('reads the destination path from a porcelain rename row (XY old -> new)', async () => {
    // git renders renames as `R  old -> new`; the scan must flag the
    // destination path, not the arrow-joined raw row.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\nR  old-name.rs -> crate/src/new-name.rs\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate');
    expect(result).toContain('crate/src/new-name.rs');
    expect(result).not.toContain('old-name.rs -> crate/src/new-name.rs');
  });

  it('strips git quoting from a quoted porcelain path', async () => {
    // git quotes paths containing spaces/unusual bytes as `"a b.rs"`; the
    // scan must compare/report the unquoted form.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n?? "crate/a file.rs"\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate');
    expect(result).toContain('crate/a file.rs');
    expect(result).not.toContain('"crate/a file.rs"');
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

describe('relativeOrSelf', () => {
  it('returns the relative path when base and target differ', () => {
    expect(relativeOrSelf('/repo', '/repo/crate/Cargo.toml')).toBe('crate/Cargo.toml');
  });

  it('returns the target verbatim when base equals target (relative is empty)', () => {
    expect(relativeOrSelf('/repo/crate/Cargo.toml', '/repo/crate/Cargo.toml')).toBe(
      '/repo/crate/Cargo.toml',
    );
  });
});
