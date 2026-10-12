import { readFile, writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ctx } from '../types.js';
import { pypiWriteVersion } from './pypi-write-version.js';

vi.mock('node:fs/promises');

const readMock = vi.mocked(readFile);
const writeMock = vi.mocked(writeFile);

function makeCtx(over: Partial<Ctx> = {}): Ctx {
  return {
    cwd: '.',
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    env: {},
    artifacts: { get: () => '', has: () => false },
    ...over,
  };
}

function basePkg(): { name: string; path: string } {
  return { name: 'demo-python', path: '.' };
}

function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
}

beforeEach(() => {
  readMock.mockReset();
  writeMock.mockReset();
});

describe('pypiWriteVersion', () => {
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
      pypiWriteVersion({ ...basePkg(), path: dir }, '0.2.0', makeCtx()),
    ).rejects.toThrow(/PIOT_PYPI_STATIC_VERSION.*dynamic\s*=\s*\["version"\]/s);
    // The handler must not have rewritten pyproject.toml on the failed call.
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('throws when pyproject.toml is missing, chaining the ENOENT as cause', async () => {
    const missing = enoent();
    readMock.mockRejectedValue(missing);
    const err = await pypiWriteVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx())
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
      pypiWriteVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx()),
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
    const err: unknown = await pypiWriteVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('disk gremlins');
  });

  it('throws when [project] is present but declares no version source', async () => {
    readMock.mockResolvedValue(['[project]', 'name = "demo"', ''].join('\n'));
    await expect(
      pypiWriteVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx()),
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
    const changed = await pypiWriteVersion(
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
    const changed = await pypiWriteVersion(
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
    const changed = await pypiWriteVersion(
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
      pypiWriteVersion({ ...basePkg(), path: dir }, '0.7.0', makeCtx()),
    ).rejects.toThrow(/PIOT_PYPI_STATIC_VERSION/);
  });

  it('throws with a distinct message when [project] table is absent entirely', async () => {
    readMock.mockResolvedValue(
      ['[build-system]', 'requires = ["setuptools>=64"]', ''].join('\n'),
    );
    await expect(
      pypiWriteVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx()),
    ).rejects.toThrow(/no \[project\] table/);
  });

  it('surfaces the TOML parser message with the file path when pyproject.toml is malformed', async () => {
    // smol-toml rejects bare `=` lines. The message names the offending
    // pyproject.toml path; assert separator-agnostically (Windows joins
    // with backslashes) rather than pinning a resolved absolute literal.
    readMock.mockResolvedValue('not = valid = toml');
    const err = await pypiWriteVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx())
      .catch((e: unknown) => e as Error) as Error;
    expect(err.message).toMatch(/failed to parse.*pyproject\.toml/s);
    // The underlying smol-toml parse error is preserved as `cause`.
    expect(err.cause).toBeInstanceOf(Error);
  });
});
