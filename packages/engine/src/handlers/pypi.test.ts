/**
 * PyPI handler tests.
 *
 * Issue #17. Plan: §6.4, §12.2, §12.3, §13.1, §14.5.
 *
 * **Architectural note (2026-04-28).** The PyPI handler no longer
 * uploads to PyPI from inside the engine; the upload happens in a
 * caller-side `pypi-publish` job that runs `pypa/gh-action-pypi-publish`.
 * The engine's role is plan + build + version-rewrite + git tag.
 * See `notes/audits/2026-04-28-pypi-tp-reusable-workflow-constraint.md`
 * and the handler comment in `pypi.ts` for the why.
 *
 * Unit-suite isolation: the subprocess boundary (the process seam,
 * `execCapture`) and the filesystem (`node:fs/promises`) are mocked so each
 * case isolates the unit under test — pyproject.toml contents are driven
 * through `readFile` resolutions rather than a real temp tree. Real
 * end-to-end file behavior is covered by the pypi integration tier
 * (tests/integration/pypi.integration.test.ts).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pypi } from './pypi.js';
import { execCapture } from '../utils/exec-capture.js';
import { TransientError } from '../types.js';
import type { Ctx } from '../types.js';

vi.mock('../utils/exec-capture.js');
vi.mock('node:fs/promises');

const execMock = vi.mocked(execCapture);
const readMock = vi.mocked(readFile);
const writeMock = vi.mocked(writeFile);

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

/** ENOENT the way `node:fs/promises` rejects it, so the handler's `code` branch fires. */
function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
}

const ENV_BAK = { ...process.env };

beforeEach(() => {
  execMock.mockReset();
  readMock.mockReset();
  writeMock.mockReset();
  delete process.env.PYPI_API_TOKEN;
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ENV_BAK)) {delete process.env[k];}
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
      new Response('not found', { status: 404 }),
    );
    expect(await pypi.isPublished(basePkg(), '9.9.9', makeCtx())).toBe(false);
    fetchSpy.mockRestore();
  });

  it('falls back to package.name when no pypi field', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    await pypi.isPublished(basePkg({ pypi: undefined as unknown as string }), '0.1.0', makeCtx());
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://pypi.org/pypi/demo-python/0.1.0/json',
      expect.any(Object) as object,
    );
    fetchSpy.mockRestore();
  });

  it('throws TransientError on 5xx', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('boom', { status: 503 }),
    );
    await expect(
      pypi.isPublished(basePkg(), '0.1.0', makeCtx()),
    ).rejects.toThrow(/503/);
    fetchSpy.mockRestore();
  });

  it('throws TransientError on 429 so the rate-limited GET retries (#580)', async () => {
    // PyPI rate-limits routine reads. A 429 is not >= 500, so it used to hit
    // the plain-Error fallthrough, which carries no `status` and is therefore
    // NOT retried by withRetry — hard-failing the publish. It must surface as
    // a TransientError (which withRetry keys on) so the check retries.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('rate limited', { status: 429 }),
    );
    await expect(
      pypi.isPublished(basePkg(), '0.1.0', makeCtx()),
    ).rejects.toBeInstanceOf(TransientError);
    fetchSpy.mockRestore();
  });

  it('throws a non-transient error on an unexpected 4xx (not 404)', async () => {
    // The endpoint contract is 200/404, but a 4xx like 403 (not 429) must
    // surface a hard (non-retryable) error rather than be misread as "not
    // published" or retried indefinitely.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('forbidden', { status: 403 }),
    );
    const err = await pypi
      .isPublished(basePkg(), '0.1.0', makeCtx())
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TransientError);
    expect((err as Error).message).toMatch(/403/);
    fetchSpy.mockRestore();
  });
});

describe('pypi.latestVersion', () => {
  it('returns info.version on 200', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ info: { version: '3.1.0' } }), { status: 200 }),
    );
    expect(await pypi.latestVersion(basePkg(), makeCtx())).toBe('3.1.0');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://pypi.org/pypi/demo-pkg/json',
      expect.objectContaining({ method: 'GET' }) as object,
    );
    fetchSpy.mockRestore();
  });

  it('returns null when the 200 body carries no info.version', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ info: {} }), { status: 200 }),
    );
    expect(await pypi.latestVersion(basePkg(), makeCtx())).toBeNull();
    fetchSpy.mockRestore();
  });

  it('returns null on 404 (never published)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"message":"Not Found"}', { status: 404 }),
    );
    expect(await pypi.latestVersion(basePkg(), makeCtx())).toBeNull();
    fetchSpy.mockRestore();
  });

  it('throws TransientError on 5xx', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 500 }),
    );
    await expect(pypi.latestVersion(basePkg(), makeCtx())).rejects.toThrow(/500/);
    fetchSpy.mockRestore();
  });
});

describe('pypi.writeVersion', () => {
  const dir = '/wv';

  it('rejects a static [project].version literal with PIOT_PYPI_STATIC_VERSION (#333)', async () => {
    // After #333, pyproject.toml MUST declare `dynamic = ["version"]`.
    // A static literal can no longer be rewritten in place: putitoutthere
    // does not edit pyproject.toml at release time (design-commitment #1),
    // and the writeVersion call point must error rather than silently
    // accept the misconfigured shape.
    readMock.mockResolvedValue(
      ['[project]', 'name = "demo"', 'version = "0.1.0"', ''].join('\n'),
    );
    await expect(
      pypi.writeVersion({ ...basePkg(), path: dir }, '0.2.0', makeCtx()),
    ).rejects.toThrow(/PIOT_PYPI_STATIC_VERSION.*dynamic\s*=\s*\["version"\]/s);
    // The handler must not have rewritten pyproject.toml on the failed call.
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('throws when pyproject.toml is missing, chaining the ENOENT as cause', async () => {
    const missing = enoent();
    readMock.mockRejectedValue(missing);
    const err = await pypi
      .writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx())
      .catch((e: unknown) => e as Error) as Error;
    expect(err.message).toMatch(/pyproject\.toml not found/);
    // The original ENOENT read error is preserved as `cause`.
    expect(err.cause).toBe(missing);
  });

  it('surfaces a non-ENOENT read error as-is (e.g. EACCES)', async () => {
    // A permission error is not the "missing file" case; it must not be
    // reported as `pyproject.toml not found` — the original error bubbles.
    readMock.mockImplementation(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    await expect(
      pypi.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx()),
    ).rejects.toThrow(/EACCES/);
  });

  it('wraps a non-Error read failure in an Error (toError String fallback)', async () => {
    // A thrown non-Error value (no `.code`, not an `instanceof Error`) skips
    // the ENOENT remap and must surface wrapped via toError() — a proper
    // Error carrying String(value) — never as a raw non-Error rejection.
    readMock.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error to hit the toError wrap
      throw 'disk gremlins';
    });
    const err: unknown = await pypi
      .writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('disk gremlins');
  });

  it('throws when [project] is present but declares no version source', async () => {
    readMock.mockResolvedValue(['[project]', 'name = "demo"', ''].join('\n'));
    await expect(
      pypi.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx()),
    ).rejects.toThrow(/declares no version source.*dynamic\s*=\s*\["version"\]/s);
  });

  it('skips the rewrite when [project].dynamic contains "version" (hatch-vcs / setuptools-scm)', async () => {
    readMock.mockResolvedValue(
      [
        '[project]',
        'name = "demo"',
        'dynamic = ["version"]',
        '',
        '[tool.hatch.version]',
        'source = "vcs"',
        '',
      ].join('\n'),
    );
    const changed = await pypi.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.0',
      makeCtx(),
    );
    expect(changed).toEqual([]);
    // Dynamic-version projects are never rewritten.
    expect(writeMock).not.toHaveBeenCalled();
    // pyproject.toml is read by that filename, as utf8 text.
    expect(readMock).toHaveBeenCalledWith(expect.stringContaining('pyproject.toml'), 'utf8');
  });

  it('emits a bare "pypi" label in the dynamic-version hint when the package has no name', async () => {
    // The guidance line is prefixed `${pkg.name ? `pypi: ${pkg.name}` : 'pypi'}`.
    // A CLI-direct `write-version` on a nameless package (name is optional on
    // the impl signature) still emits the hint, prefixed with the bare `pypi`
    // label rather than `pypi: <name>`. Pins the falsy-name branch.
    const infoLines: string[] = [];
    readMock.mockResolvedValue(['[project]', 'dynamic = ["version"]', ''].join('\n'));
    const pkg = { ...basePkg(), path: dir };
    delete (pkg as { name?: string }).name;
    const changed = await pypi.writeVersion(
      pkg,
      '0.2.0',
      makeCtx({
        log: {
          debug: () => {},
          info: (m: string) => infoLines.push(m),
          warn: () => {},
          error: () => {},
        },
      }),
    );
    expect(changed).toEqual([]);
    const joined = infoLines.join('\n');
    expect(joined).toContain('detected dynamic version');
    // Bare `pypi:` label, not `pypi: <name>:`.
    expect(joined.startsWith('pypi: detected dynamic version')).toBe(true);
  });

  it('skips the rewrite when "version" is one of several entries in dynamic', async () => {
    readMock.mockResolvedValue(
      [
        '[project]',
        'name = "demo"',
        'dynamic = ["readme", "version", "classifiers"]',
        '',
      ].join('\n'),
    );
    const changed = await pypi.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.0',
      makeCtx(),
    );
    expect(changed).toEqual([]);
  });

  it('rejects when dynamic array is present but does not include "version" and a literal exists (#333)', async () => {
    // The literal still drives the build backend regardless of what
    // other entries `dynamic` carries, so the rule is the same as the
    // plain static-literal case: reject with PIOT_PYPI_STATIC_VERSION.
    readMock.mockResolvedValue(
      [
        '[project]',
        'name = "demo"',
        'dynamic = ["readme", "classifiers"]',
        'version = "0.1.0"',
        '',
      ].join('\n'),
    );
    await expect(
      pypi.writeVersion({ ...basePkg(), path: dir }, '0.7.0', makeCtx()),
    ).rejects.toThrow(/PIOT_PYPI_STATIC_VERSION/);
  });

  it('throws with a distinct message when [project] table is absent entirely', async () => {
    readMock.mockResolvedValue(
      ['[build-system]', 'requires = ["setuptools>=64"]', ''].join('\n'),
    );
    await expect(
      pypi.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx()),
    ).rejects.toThrow(/no \[project\] table/);
  });

  it('surfaces the TOML parser message with the file path when pyproject.toml is malformed', async () => {
    // smol-toml rejects bare `=` lines. The message names the offending
    // pyproject.toml path; assert separator-agnostically (Windows joins
    // with backslashes) rather than pinning a resolved absolute literal.
    readMock.mockResolvedValue('not = valid = toml');
    const err = await pypi
      .writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx())
      .catch((e: unknown) => e as Error) as Error;
    expect(err.message).toMatch(/failed to parse.*pyproject\.toml/s);
    // The underlying smol-toml parse error is preserved as `cause`.
    expect(err.cause).toBeInstanceOf(Error);
  });
});

// Phase 2 architecture (2026-04-28): the engine no longer uploads to
// PyPI. The handler's `publish` is a thin shim — it checks
// `isPublished`, logs a delegation breadcrumb, and returns
// `{ status: 'published' }` so `publish.ts` creates+pushes the git tag.
// The actual upload runs in the caller's `pypi-publish` job.
describe('pypi.publish (caller-side upload architecture)', () => {
  it('returns already-published when the version is already on PyPI', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    const result = await pypi.publish(
      basePkg(),
      '0.1.0',
      makeCtx(),
    );
    expect(result.status).toBe('already-published');
    fetchSpy.mockRestore();
  });

  it('returns status=published without shelling out to twine', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    const result = await pypi.publish(
      basePkg(),
      '0.1.0',
      makeCtx(),
    );
    expect(result.status).toBe('published');
    // Critical: the engine must NOT shell out to twine. The caller's
    // pypi-publish job runs `pypa/gh-action-pypi-publish` instead.
    expect(execMock).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('returned URL points at the PyPI project/version landing page', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    const result = await pypi.publish(
      basePkg(),
      '0.3.7',
      makeCtx(),
    );
    expect(result.url).toBe('https://pypi.org/project/demo-pkg/0.3.7/');
    fetchSpy.mockRestore();
  });

  it('logs a delegation hint pointing at the README recipe', async () => {
    // Surfaces the architectural shift in run logs so a reader of the
    // engine's output knows the upload happens elsewhere — the most
    // common confusion when foreign agents debug a "publish job
    // succeeded but version isn't on PyPI yet" symptom.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    const infoLines: string[] = [];
    await pypi.publish(
      basePkg(),
      '0.1.0',
      makeCtx({
        log: {
          debug: () => {},
          info: (msg: string) => infoLines.push(msg),
          warn: () => {},
          error: () => {},
        },
      }),
    );
    expect(infoLines.some((m) => /caller-side|pypi-publish|gh-action-pypi-publish/i.test(m))).toBe(true);
    fetchSpy.mockRestore();
  });

  it('does not require any token-related env to succeed', async () => {
    // The handler's interface no longer touches PYPI_API_TOKEN /
    // ACTIONS_ID_TOKEN_REQUEST_*. Verifies no env access creeps back
    // in during a future refactor.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    delete process.env.PYPI_API_TOKEN;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    const result = await pypi.publish(
      basePkg(),
      '0.1.0',
      makeCtx({ env: {} }),
    );
    expect(result.status).toBe('published');
    fetchSpy.mockRestore();
  });
});


describe('pypi.trustPosture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockPypi(opts: {
    jsonStatus?: number;
    urls?: Array<{ filename?: string }>;
    provStatus?: number;
  }): void {
    vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/provenance')) {
        return Promise.resolve(new Response('{}', { status: opts.provStatus ?? 404 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ urls: opts.urls ?? [] }), { status: opts.jsonStatus ?? 200 }),
      );
    });
  }

  it('oidc when the integrity provenance endpoint returns 200', async () => {
    mockPypi({ urls: [{ filename: 'demo-0.1.0.tar.gz' }], provStatus: 200 });
    expect(await pypi.trustPosture(basePkg(), '0.1.0', makeCtx())).toBe('oidc');
  });

  it('token when the integrity provenance endpoint returns 404', async () => {
    mockPypi({ urls: [{ filename: 'demo-0.1.0.tar.gz' }], provStatus: 404 });
    expect(await pypi.trustPosture(basePkg(), '0.1.0', makeCtx())).toBe('token');
  });

  it('token when the published version has no files', async () => {
    mockPypi({ urls: [] });
    expect(await pypi.trustPosture(basePkg(), '0.1.0', makeCtx())).toBe('token');
  });

  it('throws when the version json is unreachable', async () => {
    mockPypi({ jsonStatus: 503 });
    await expect(pypi.trustPosture(basePkg(), '0.1.0', makeCtx())).rejects.toThrow(/503/);
  });

  it('throws when the provenance endpoint errors', async () => {
    mockPypi({ urls: [{ filename: 'x' }], provStatus: 500 });
    await expect(pypi.trustPosture(basePkg(), '0.1.0', makeCtx())).rejects.toThrow(/500/);
  });
});
