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
 */

import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
});

describe('pypi.writeVersion', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pypi-wv-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rewrites the [project].version field in pyproject.toml', async () => {
    const p = join(dir, 'pyproject.toml');
    writeFileSync(
      p,
      ['[project]', 'name = "demo"', 'version = "0.1.0"', ''].join('\n'),
      'utf8',
    );
    const changed = await pypi.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.0',
      makeCtx(),
    );
    expect(changed).toEqual([p]);
    expect(readFileSync(p, 'utf8')).toContain('version = "0.2.0"');
  });

  it('is idempotent when version already matches', async () => {
    const p = join(dir, 'pyproject.toml');
    writeFileSync(
      p,
      ['[project]', 'name = "demo"', 'version = "0.5.0"', ''].join('\n'),
      'utf8',
    );
    const changed = await pypi.writeVersion(
      { ...basePkg(), path: dir },
      '0.5.0',
      makeCtx(),
    );
    expect(changed).toEqual([]);
  });

  it('throws when pyproject.toml is missing', async () => {
    await expect(
      pypi.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx()),
    ).rejects.toThrow(/pyproject\.toml not found/);
  });

  it('throws when [project] is present but declares neither static version nor dynamic (issue #171)', async () => {
    const p = join(dir, 'pyproject.toml');
    writeFileSync(
      p,
      ['[project]', 'name = "demo"', ''].join('\n'),
      'utf8',
    );
    await expect(
      pypi.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx()),
    ).rejects.toThrow(/declares neither a static version nor dynamic/);
  });

  it('preserves comments', async () => {
    const p = join(dir, 'pyproject.toml');
    const original = [
      '# top comment',
      '[project]',
      'name = "demo"  # inline comment',
      '# preceding line',
      'version = "0.1.0"  # version comment',
      'description = "demo"',
      '',
    ].join('\n');
    writeFileSync(p, original, 'utf8');
    await pypi.writeVersion({ ...basePkg(), path: dir }, '0.9.0', makeCtx());
    const out = readFileSync(p, 'utf8');
    expect(out).toContain('# top comment');
    expect(out).toContain('# inline comment');
    expect(out).toContain('# preceding line');
    expect(out).toContain('# version comment');
    expect(out).toContain('version = "0.9.0"');
  });

  it('skips the rewrite when [project].dynamic contains "version" (hatch-vcs / setuptools-scm)', async () => {
    const p = join(dir, 'pyproject.toml');
    writeFileSync(
      p,
      [
        '[project]',
        'name = "demo"',
        'dynamic = ["version"]',
        '',
        '[tool.hatch.version]',
        'source = "vcs"',
        '',
      ].join('\n'),
      'utf8',
    );
    const changed = await pypi.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.0',
      makeCtx(),
    );
    expect(changed).toEqual([]);
    // pyproject.toml unchanged.
    expect(readFileSync(p, 'utf8')).toContain('dynamic = ["version"]');
  });

  it('skips the rewrite when "version" is one of several entries in dynamic', async () => {
    const p = join(dir, 'pyproject.toml');
    writeFileSync(
      p,
      [
        '[project]',
        'name = "demo"',
        'dynamic = ["readme", "version", "classifiers"]',
        '',
      ].join('\n'),
      'utf8',
    );
    const changed = await pypi.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.0',
      makeCtx(),
    );
    expect(changed).toEqual([]);
  });

  it('rewrites normally when dynamic array is present but does not include "version"', async () => {
    const p = join(dir, 'pyproject.toml');
    writeFileSync(
      p,
      [
        '[project]',
        'name = "demo"',
        'dynamic = ["readme", "classifiers"]',
        'version = "0.1.0"',
        '',
      ].join('\n'),
      'utf8',
    );
    const changed = await pypi.writeVersion(
      { ...basePkg(), path: dir },
      '0.7.0',
      makeCtx(),
    );
    expect(changed).toEqual([p]);
    expect(readFileSync(p, 'utf8')).toContain('version = "0.7.0"');
  });

  it('throws with a distinct message when [project] table is absent entirely', async () => {
    const p = join(dir, 'pyproject.toml');
    writeFileSync(
      p,
      ['[build-system]', 'requires = ["setuptools>=64"]', ''].join('\n'),
      'utf8',
    );
    await expect(
      pypi.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx()),
    ).rejects.toThrow(/no \[project\] table/);
  });

  it('surfaces the TOML parser message with the file path when pyproject.toml is malformed', async () => {
    const p = join(dir, 'pyproject.toml');
    // smol-toml rejects bare `=` lines.
    writeFileSync(p, 'not = valid = toml', 'utf8');
    await expect(
      pypi.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx()),
    ).rejects.toThrow(new RegExp(`failed to parse.*${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
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

describe('scmEnvSuffix (#207)', () => {
  it('uppercases + collapses dashes, dots, underscores to `_` per PEP 503', () => {
    expect(scmEnvSuffix('my-lib')).toBe('MY_LIB');
    expect(scmEnvSuffix('my.lib')).toBe('MY_LIB');
    expect(scmEnvSuffix('my_lib')).toBe('MY_LIB');
    expect(scmEnvSuffix('my--lib')).toBe('MY_LIB');
    expect(scmEnvSuffix('coaxer')).toBe('COAXER');
  });
});
