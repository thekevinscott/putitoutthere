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
import { writeDependentVersionReqs } from '../write-dependent-version-reqs.js';

vi.mock('../utils/exec-error.js', async () => await vi.importActual<typeof import('../utils/exec-error.js')>('../utils/exec-error.js'));
import { crates, relativeOrSelf } from './crates.js';
import type { Ctx } from '../types.js';

vi.mock('../utils/exec-capture.js');
vi.mock('node:fs/promises');
vi.mock('../write-dependent-version-reqs.js', async () => ({
  ...await vi.importActual<typeof import('../write-dependent-version-reqs.js')>('../write-dependent-version-reqs.js'),
  writeDependentVersionReqs: vi.fn((): Promise<string[]> => Promise.resolve([])),
}));

const execMock = vi.mocked(execCapture);
const readMock = vi.mocked(readFile);
const depsMock = vi.mocked(writeDependentVersionReqs);
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
  // Reset the implementation too, not just the calls: a case that stubs a
  // rewritten dependent would otherwise leak it into the next one.
  depsMock.mockReset();
  depsMock.mockResolvedValue([]);
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

  it('throws TransientError on 5xx (500 boundary) so the check retries', async () => {
    // Use the exact 500 boundary and assert the error TYPE (name), not just a
    // status substring: a plain Error whose message merely contains "500"
    // would pass a message regex, so it could not distinguish the `>= 500`
    // transient branch from the plain-Error fallthrough (nor a `>= 500` →
    // `> 500` off-by-one). `.name === 'TransientError'` pins the retryable
    // contract at the boundary.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 500 }),
    );
    const err = await crates
      .isPublished(basePkg(), '0.1.0', makeCtx())
      .then(() => null, (e: unknown) => e);
    expect((err as Error).name).toBe('TransientError');
    expect((err as Error).message).toMatch(/returned 500/);
    fetchSpy.mockRestore();
  });

  it('throws TransientError on 429 so the rate-limited GET retries (#580)', async () => {
    // crates.io rate-limits routine reads. A 429 is not >= 500, so it used
    // to hit the plain-Error fallthrough, which carries no `status` and is
    // therefore NOT retried by withRetry — hard-failing the publish. It must
    // surface as a TransientError (which withRetry keys on) so the check
    // retries instead.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('rate limited', { status: 429 }),
    );
    // TransientError sets `name = 'TransientError'`; assert on the name rather
    // than importing the class as a value (which would trip the unit-suite's
    // unmocked-collaborator isolation gate). withRetry keys on the class via
    // instanceof — the retry integration test proves the real retry path.
    const err = await crates
      .isPublished(basePkg(), '0.1.0', makeCtx())
      .then(() => null, (e: unknown) => e);
    expect((err as Error).name).toBe('TransientError');
    fetchSpy.mockRestore();
  });

  it('throws a plain Error on an unexpected 4xx (defensive fallthrough)', async () => {
    // crates.io returns 200/404 for this endpoint; a bare 4xx (not 404, not
    // 429, not 5xx) is not retriable, so it surfaces as a plain Error (name
    // 'Error', NOT 'TransientError') with the status in the message.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 403 }),
    );
    const err = await crates
      .isPublished(basePkg(), '0.1.0', makeCtx())
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('Error');
    expect((err as Error).message).toMatch(/returned 403/);
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

  it("appends the dependents' manifests to its own, and passes the siblings through (#640)", async () => {
    // `writeVersion` composes two writes: this crate's own version, through
    // the #428 resolver, and the in-repo requirements pointing at it. The
    // pre-publish dirty-tree guard consumes the union, so the second has to
    // be APPENDED to the first — returning either alone leaves the guard
    // refusing a file the engine itself wrote. `ctx.siblingPackagePaths`
    // must reach the walk too, or a sibling that path-deps this crate from
    // outside the workspace is never visited and its requirement is left
    // stranded below the released version.
    readMock.mockResolvedValue(`[package]\nname = "core"\nversion = "0.1.0"\n`);
    depsMock.mockResolvedValue(['/repo/packages/host/Cargo.toml']);

    const paths = await crates.writeVersion(
      { ...basePkg(), path: dir },
      '0.4.2',
      makeCtx({ cwd: dir, siblingPackagePaths: ['/repo/packages/host'] }),
    );

    expect(depsMock).toHaveBeenCalledWith(dir, '0.4.2', ['/repo/packages/host']);
    expect(paths).toHaveLength(2);
    expect(paths[0]!.endsWith('Cargo.toml')).toBe(true);
    expect(paths[1]).toBe('/repo/packages/host/Cargo.toml');
  });

  it('is idempotent when version already matches', async () => {
    readMock.mockResolvedValue(`[package]\nname = "demo"\nversion = "1.0.0"\n`);
    const paths = await crates.writeVersion(
      { ...basePkg(), path: dir },
      '1.0.0',
      makeCtx({ cwd: dir }),
    );
    // No write: the manifest already says 1.0.0.
    expect(writeMock).not.toHaveBeenCalled();
    // The return value reports the manifest this bump MANAGES, not the set
    // of files that changed — that is what the pre-publish dirty-tree guard
    // consumes (#639), and a no-op bump still owns the same manifest. Same
    // semantics `writeResolvedCargoVersion` has had since #428.
    expect(paths).toHaveLength(1);
    expect(paths[0]!.endsWith('Cargo.toml')).toBe(true);
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

    /**
     * #651. `--verbose` plus `CARGO_TERM_VERBOSE=true` makes a cold verify
     * build's stderr run to hundreds of KB. The rendered message is logged
     * on one line and GitHub cuts a log line at 64KB from the *front*, so
     * an unelided render throws away cargo's error and keeps the healthy
     * build chatter.
     *
     * Assertions here are booleans rather than `toContain` on purpose: a
     * failed matcher against a ~480KB string prints the whole string into
     * the test report, which is the same disease under a different roof.
     */
    // No leading indent on the head marker: the handler trims the stream
    // before rendering, so cargo's leading spaces are gone by then.
    const HUGE_HEAD = 'Updating crates.io index';
    const HUGE_TAIL = 'error: could not compile `demo-crate` (lib)';
    const hugeStderr = (tail: string = HUGE_TAIL): string =>
      [`       ${HUGE_HEAD}`, '   Compiling noise v1.0.0\n'.repeat(20_000), tail].join('\n');
    const ELIDED = /\[\.\.\. \d+ bytes elided \.\.\.\]/;
    const GHA_LOG_LINE_LIMIT = 64 * 1024;

    it('elides the middle of an oversized cargo stderr in the failure message (#651)', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      const huge = hugeStderr();
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        return Promise.reject(new ExecError('exit 1', '', huge, 1));
      });
      process.env.CARGO_REGISTRY_TOKEN = 'tok';
      const err = await crates
        .publish(
          { ...basePkg(), path: dir },
          '0.1.0',
          makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'tok' } }),
        )
        .catch((e: unknown) => e as Error) as Error;
      expect({
        fits: err.message.length <= GHA_LOG_LINE_LIMIT,
        head: err.message.includes(HUGE_HEAD),
        tail: err.message.endsWith(HUGE_TAIL),
        elided: ELIDED.test(err.message),
      }).toEqual({ fits: true, head: true, tail: true, elided: true });
      // Eliding the message is only safe because the full stream survives on
      // the `cause`: `publish.ts` walks the chain with `findExecError` to
      // build the job-summary dump, which is the copy holding everything the
      // message dropped. Lose the cause and the dump reports an empty
      // command, empty stdout and exit code -1 — the elided middle would then
      // exist nowhere.
      expect(err.cause).toBeInstanceOf(ExecError);
      expect((err.cause as ExecError).stderr).toBe(huge);
      fetchSpy.mockRestore();
    });

    it('elides the middle of an oversized fallback stderr too (#651)', async () => {
      // The fallback render is a second interpolation site, so it needs
      // its own bound — a 429 on crates.io followed by a verbose failure
      // against the fallback registry is exactly as long.
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
        return Promise.reject(new ExecError('exit 1', '', hugeStderr(), 1));
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
      expect({
        fits: err.message.length <= GHA_LOG_LINE_LIMIT,
        head: err.message.includes('fallback http://localhost:8000'),
        tail: err.message.endsWith(HUGE_TAIL),
        elided: ELIDED.test(err.message),
      }).toEqual({ fits: true, head: true, tail: true, elided: true });
      stdoutSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('still reads the whole stderr when deciding, only the render is bounded (#651)', async () => {
      // The elision happens where the message is built, not where stderr is
      // captured. Put the rate-limit prose ~500KB deep — past anything a
      // bounded render would keep — and the 429 fallback must still engage.
      // A predicate reading the elided text instead would miss it.
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      let cargoCalls = 0;
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        cargoCalls += 1;
        if (cargoCalls === 1) {
          return Promise.reject(
            new ExecError('exit 1', '', hugeStderr('status 429 Too Many Requests'), 1),
          );
        }
        return Promise.resolve(ok(''));
      });
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((): boolean => true);
      process.env.CARGO_REGISTRY_TOKEN = 'tok';
      const res = await crates.publish(
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
      expect(res.url).toBe('http://localhost:8000/api/v1/crates/demo-crate/0.1.0');
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
      // The matched cargo stderr is hoisted into the message verbatim.
      expect(msg).toContain(STDERR);
      // The hint lines are newline-joined (not concatenated): the summary
      // line and the TP-binding explanation sit on separate lines.
      expect(msg).toContain('has never been published.\ncrates.io Trusted Publishing binds');
      fetchSpy.mockRestore();
    });

    it('elides the quoted stderr when the rejection arrives buried in a verbose log (#651)', async () => {
      // The bootstrap hint quotes cargo's stderr verbatim. On a crate whose
      // verify build ran before the 404, that quote is hundreds of KB and
      // GitHub's 64KB line cut takes the hint away with it — so the quote
      // is bounded while the detector still scans the whole stream.
      const huge = ['       Updating crates.io index', '   Compiling noise v1.0.0\n'.repeat(20_000), STDERR].join('\n');
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 404 }),
      );
      execMock.mockImplementation((file: string) => {
        if (file === 'git') {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        return Promise.reject(new ExecError('exit 1', '', huge, 1));
      });
      process.env.CARGO_REGISTRY_TOKEN = 'tok';
      const err = await crates
        .publish(
          { ...basePkg(), path: dir },
          '0.1.0',
          makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'tok' } }),
        )
        .catch((e: unknown) => e as Error) as Error;
      // Booleans, not `toContain`: a failed matcher on a ~500KB string
      // dumps the whole thing into the report.
      expect({
        detected: err.message.includes('PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED'),
        hint: err.message.includes('Bootstrap by setting CARGO_REGISTRY_TOKEN'),
        fits: err.message.length <= 64 * 1024,
        evidence: err.message.endsWith(STDERR),
        elided: /\[\.\.\. \d+ bytes elided \.\.\.\]/.test(err.message),
      }).toEqual({ detected: true, hint: true, fits: true, evidence: true, elided: true });
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


describe('crates.publish dirty-tree guard (#135)', () => {
  // The scan itself is covered in scan-dirty-outside-manifest.test.ts; this
  // pins that publish actually consults it and refuses. git is routed here
  // directly: a dirty README stops the handler before cargo is ever invoked.
  it('rejects with a clear error when an unrelated file is dirty', async () => {
    execMock.mockImplementation((file: string, args?: readonly string[]) => {
      if (file !== 'git') {return Promise.reject(new ExecError(`unexpected exec: ${file}`, '', '', null));}
      const a = (args ?? []) as string[];
      if (a[0] === 'rev-parse') {return Promise.resolve(ok('/repo\n'));}
      if (a[0] === 'ls-files') {return Promise.resolve(ok('crate/Cargo.toml\n'));}
      if (a[0] === 'status') {return Promise.resolve(ok(' M crate/Cargo.toml\n M README.md\n'));}
      return Promise.reject(new ExecError(`unexpected git: ${a.join(' ')}`, '', '', null));
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
