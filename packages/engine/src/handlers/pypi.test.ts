/**
 * PyPI handler tests (#17). The handler no longer uploads to PyPI — that
 * happens caller-side via `pypa/gh-action-pypi-publish`; the engine's role is
 * plan + build + version-rewrite + git tag. See
 * `notes/audits/2026-04-28-pypi-tp-reusable-workflow-constraint.md`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pypi } from './pypi.js';
import { pypiIsPublished } from './pypi-is-published.js';
import { pypiLatestVersion } from './pypi-latest-version.js';
import { pypiTrustPosture } from './pypi-trust-posture.js';
import { pypiWriteVersion } from './pypi-write-version.js';
import { execCapture } from '../utils/exec-capture.js';
import type { Ctx } from '../types.js';

vi.mock('../utils/exec-capture.js');
vi.mock('./pypi-is-published.js', async () => await vi.importActual<typeof import('./pypi-is-published.js')>('./pypi-is-published.js'));
vi.mock('./pypi-name-for.js', async () => await vi.importActual<typeof import('./pypi-name-for.js')>('./pypi-name-for.js'));
vi.mock('./pypi-latest-version.js');
vi.mock('./pypi-trust-posture.js');
vi.mock('./pypi-write-version.js');

const execMock = vi.mocked(execCapture);

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
    if (!(k in ENV_BAK)) {delete process.env[k];}
  }
  Object.assign(process.env, ENV_BAK);
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

  it('returns status=delegated without shelling out to twine (#623)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    const result = await pypi.publish(
      basePkg(),
      '0.1.0',
      makeCtx(),
    );
    // `delegated`, not `published`: nothing has been uploaded, so the
    // publish path must not cut this package's git tag (#623). Reporting
    // `published` here is what left tags on the remote naming versions
    // that were never uploaded.
    expect(result.status).toBe('delegated');
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
    // Pinned whole: each line carries a distinct fact a reader needs —
    // that the upload was handed off, which job performs it, which action
    // it uses, that the tag is cut there too (#623: the only place a
    // reader learns why a green publish job cut no pypi tag), and where
    // the recipe lives.
    expect(infoLines).toEqual([
      [
        'pypi: demo-python@0.1.0 delegated to caller-side upload step.',
        '  The upload runs in your `pypi-publish` job via `pypa/gh-action-pypi-publish`;',
        '  the git tag is cut there too, after PyPI confirms the version is live.',
        '  See README → "Publishing to PyPI" for the recipe.',
      ].join('\n'),
    ]);
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
    expect(result.status).toBe('delegated');
    fetchSpy.mockRestore();
  });
});

describe('pypi handler', () => {
  it('wires each registry operation to its pypi implementation', () => {
    expect(pypi).toMatchObject({
      kind: 'pypi',
      isPublished: pypiIsPublished,
      latestVersion: pypiLatestVersion,
      trustPosture: pypiTrustPosture,
      writeVersion: pypiWriteVersion,
    });
  });
});
