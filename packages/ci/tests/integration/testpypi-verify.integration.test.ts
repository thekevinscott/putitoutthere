/**
 * Integration test for the TestPyPI verify/assert harness (#455, epic #442).
 *
 * Drives the real `piot-ci testpypi-verify <mode>` dispatch in-process — `run()`
 * → `runTestpypiVerify` → `runTestpypiAssert` / `runTestpypiMetadata` and every
 * real decision (requirements build, simple-index parse, member selection,
 * version match) — with only the OS/network boundary (`node:fs/promises`, the
 * exec seam) mocked. Unlike the colocated `*.test.ts` wiring tests (which mock
 * the decisions), this exercises the genuine parsing/matching, so the mock
 * cannot silently disagree with the pure cores.
 */

import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { execFile, spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

// Integration tests run first-party code (the exec seam + the real `sleep`)
// for real and mock only the platform boundaries underneath: `execFile` (what
// `execCapture` uses, for curl/unzip/tar), `spawn` (what `execInherit` uses)
// and the global `fetch` the release-metadata probe reads. On the happy path
// every artifact resolves on the first attempt, so the retry `sleep` is never
// reached — leaving `sleep` un-mocked (mocking it would trip the
// testing-conventions `no-first-party-mock` gate) is safe. The lag scenarios
// below do exhaust the budget, and drive it with fake timers rather than
// waiting the real 450s.
vi.mock('node:fs/promises');
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn(), spawn: vi.fn() };
});

const execFileMock = vi.mocked(execFile);
const spawnMock = vi.mocked(spawn);
const readdirMock = vi.mocked(readdir);
let out: string[];
let err: string[];

/** A minimal spawn() stand-in that emits `close` with `code` on the next tick. */
function fakeChild(code: number): ChildProcess.ChildProcess {
  const child = new EventEmitter() as ChildProcess.ChildProcess;
  queueMicrotask(() => child.emit('close', code));
  return child;
}

/**
 * Route an `execCapture` call (mocked at `execFile`) by cmd/args. `fn` returns
 * the captured stdout the seam resolves with; stderr is always empty.
 */
function captureImpl(fn: (cmd: string, a: string[]) => string): void {
  execFileMock.mockImplementation(((cmd: string, args: readonly string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    cb(null, fn(cmd, [...(args ?? [])]), '');
    return undefined as unknown as ChildProcess.ChildProcess;
  }) as unknown as typeof execFile);
}

const DIST_FILES = [
  'piot_fixture_zzz_python_maturin-0.0.1.tar.gz',
  'piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-manylinux.whl',
  'piot_fixture_zzz_python_hatch-0.0.1.tar.gz',
  'piot_fixture_zzz_python_hatch-0.0.1-py3-none-any.whl',
];

function fileDirent(name: string): { name: string; isFile: () => boolean } {
  return { name, isFile: () => true };
}

function stemOf(text: string): string {
  return text.includes('maturin') ? 'piot_fixture_zzz_python_maturin' : 'piot_fixture_zzz_python_hatch';
}

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    err.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  // Every pip download (`execInherit` → spawn) exits 0.
  spawnMock.mockImplementation(((() => fakeChild(0)) as unknown) as typeof spawn);
  process.env.TESTPYPI_INDEX_URL = 'https://test.pypi.org/simple/';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.TESTPYPI_INDEX_URL;
});

const verify = (mode: string): Promise<number> => run(['node', 'piot-ci', 'testpypi-verify', mode]);

/**
 * Drive a run whose retry loop `await`s the real `sleep()` without waiting the
 * real budget. Each back-off timer is only scheduled once the awaited failure
 * settles as a microtask, so a single `runAllTimersAsync` would see no timer
 * yet; loop, flushing a microtask each turn, until the run settles.
 */
async function withFakeTimers(fn: () => Promise<number>): Promise<number> {
  vi.useFakeTimers();
  try {
    const pending = fn();
    let done = false;
    void pending.then(
      () => { done = true; },
      () => { done = true; },
    );
    while (!done) {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    }
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

/** A `fetch` Response stand-in carrying just the status and body the probe reads. */
function jsonResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

/** The `/pypi/{name}/{version}/json` payload TestPyPI serves for a published release. */
function releaseJson(stem: string): string {
  return JSON.stringify({
    info: { version: '0.0.1' },
    urls: [
      {
        packagetype: 'bdist_wheel',
        filename: `${stem}-0.0.1-cp312-cp312-manylinux.whl`,
        url: `https://test-files.pythonhosted.org/packages/ab/${stem}-0.0.1-cp312-cp312-manylinux.whl`,
      },
      {
        packagetype: 'sdist',
        filename: `${stem}-0.0.1.tar.gz`,
        url: `https://test-files.pythonhosted.org/packages/cd/${stem}-0.0.1.tar.gz`,
      },
    ],
  });
}

/**
 * `readdir` for the whole metadata flow: `dist/` holds both fixtures' build
 * outputs, and the two download directories hold what a successful fetch left
 * behind.
 */
function stubReaddir(): void {
  readdirMock.mockImplementation(((dir: string) => {
    if (dir === 'dist') {
      return Promise.resolve(DIST_FILES.map(fileDirent));
    }
    if (dir === 'downloaded-wheels') {
      return Promise.resolve([
        'piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-manylinux.whl',
        'piot_fixture_zzz_python_hatch-0.0.1-py3-none-any.whl',
      ]);
    }
    return Promise.resolve([
      'piot_fixture_zzz_python_maturin-0.0.1.tar.gz',
      'piot_fixture_zzz_python_hatch-0.0.1.tar.gz',
    ]);
  }) as unknown as typeof readdir);
}

/**
 * A TestPyPI whose `/simple/` index is stale — it still lists only the
 * previous version, so `pip download` finds no matching distribution and the
 * sdist anchor search comes up empty, exactly as in the #668 runs.
 */
function stubStaleSimpleIndex(): void {
  spawnMock.mockImplementation(((() => fakeChild(1)) as unknown) as typeof spawn);
  captureImpl((cmd, a) => {
    if (cmd === 'curl' && a[1] === '-o') {
      return '';
    }
    if (cmd === 'curl') {
      const stale = `${stemOf(a[1] ?? '')}-0.0.0.tar.gz`;
      return `<html><body><a href="https://files/${stale}#sha256=z">${stale}</a></body></html>`;
    }
    if (cmd === 'unzip' && a[0] === '-Z1') {
      return `${stemOf(a[1] ?? '')}-0.0.1.dist-info/METADATA\n`;
    }
    if (cmd === 'tar' && a[0] === '-tzf') {
      return `${stemOf(a[1] ?? '')}-0.0.1/PKG-INFO\n`;
    }
    return 'Name: x\nVersion: 0.0.1\n';
  });
}

describe('piot-ci testpypi-verify (integration)', () => {
  it('assert: prints the sorted dist listing and exits 0 when every artifact exists', async () => {
    readdirMock.mockResolvedValue(DIST_FILES.map(fileDirent) as unknown as Awaited<ReturnType<typeof readdir>>);
    await expect(verify('assert')).resolves.toBe(0);
    expect(out.join('')).toBe(
      'dist/piot_fixture_zzz_python_hatch-0.0.1-py3-none-any.whl\n' +
        'dist/piot_fixture_zzz_python_hatch-0.0.1.tar.gz\n' +
        'dist/piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-manylinux.whl\n' +
        'dist/piot_fixture_zzz_python_maturin-0.0.1.tar.gz\n',
    );
  });

  it('assert: fails with the exact error when a fixture wheel is missing', async () => {
    readdirMock.mockResolvedValue(
      DIST_FILES.filter((name) => name !== 'piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-manylinux.whl').map(
        fileDirent,
      ) as unknown as Awaited<ReturnType<typeof readdir>>,
    );
    await expect(verify('assert')).resolves.toBe(1);
    expect(out.join('')).toContain('::error::missing piot_fixture_zzz_python_maturin wheel artifact for TestPyPI');
  });

  it('metadata: downloads and verifies both fixtures end to end', async () => {
    readdirMock.mockImplementation(((dir: string) => {
      if (dir === 'dist') {
        return Promise.resolve(DIST_FILES.map(fileDirent));
      }
      if (dir === 'downloaded-wheels') {
        return Promise.resolve([
          'piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-manylinux.whl',
          'piot_fixture_zzz_python_hatch-0.0.1-py3-none-any.whl',
        ]);
      }
      return Promise.resolve(['piot_fixture_zzz_python_maturin-0.0.1.tar.gz', 'piot_fixture_zzz_python_hatch-0.0.1.tar.gz']);
    }) as unknown as typeof readdir);

    // pip download runs through `execInherit` → spawn, wired to exit 0 above.

    captureImpl((cmd, a) => {
      if (cmd === 'curl') {
        if (a[1] === '-o') {
          return '';
        }
        const file = `${stemOf(a[1] ?? '')}-0.0.1.tar.gz`;
        return `<html><body><a href="https://files/${file}#sha256=z">${file}</a></body></html>`;
      }
      if (cmd === 'unzip' && a[0] === '-Z1') {
        return `${stemOf(a[1] ?? '')}-0.0.1.dist-info/METADATA\n${stemOf(a[1] ?? '')}-0.0.1.dist-info/RECORD\n`;
      }
      if (cmd === 'tar' && a[0] === '-tzf') {
        return `${stemOf(a[1] ?? '')}-0.0.1/PKG-INFO\n${stemOf(a[1] ?? '')}-0.0.1/setup.py\n`;
      }
      // unzip -p / tar -xzOf: the metadata blob
      return 'Name: x\nVersion: 0.0.1\n';
    });

    await expect(verify('metadata')).resolves.toBe(0);
    expect(err.join('')).toBe('');
    const printed = out.join('');
    expect(printed).toContain('Downloading wheel for piot-fixture-zzz-python-maturin==0.0.1 from TestPyPI\n');
    expect(printed).toContain(
      'Downloading sdist for piot-fixture-zzz-python-hatch==0.0.1 from https://files/piot_fixture_zzz_python_hatch-0.0.1.tar.gz#sha256=z\n',
    );
    expect(printed).toContain('ok: piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-manylinux.whl METADATA Version=0.0.1\n');
    expect(printed).toContain('ok: piot_fixture_zzz_python_hatch-0.0.1.tar.gz PKG-INFO Version=0.0.1\n');
  });
});

/**
 * #668. TestPyPI's `/simple/{project}/` page is a hot, edge-cached URL: PyPI
 * renders it from the database at request time, so the origin is never stale
 * — only Fastly is, and every prior fixture run has already warmed that cache
 * object. Polling it harder cannot shorten a CDN TTL, which is why the budget
 * has been raised twice (#642, #643) and blown through anyway: 450s exhausted
 * on PR #645 (job 99631849738) and PR #663 (job 99635856349) with the publish
 * already successful.
 *
 * The gate's job is to prove the *published artifacts* carry the right
 * metadata, not to measure how fast an index page propagates. So it reads the
 * release from `/pypi/{project}/{version}/json` — a version-pinned URL that,
 * for a timestamped fixture version, has never been requested before this
 * publish and therefore cannot be served from a stale cache object — and pulls
 * the files from the immutable `test-files.pythonhosted.org` URLs it lists.
 * Same artifacts, same assertions, a surface that cannot lag.
 *
 * The two states the old gate could not tell apart are pinned separately
 * below: "the index has not caught up" (must still verify) and "this version
 * is not on TestPyPI" (must still fail, and say so).
 */
describe('piot-ci testpypi-verify metadata vs. TestPyPI index lag (#668)', () => {
  it('verifies the release even when the /simple/ index has not caught up', async () => {
    stubReaddir();
    stubStaleSimpleIndex();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(jsonResponse(200, releaseJson(stemOf(url)))),
      ),
    );

    await expect(withFakeTimers(() => verify('metadata'))).resolves.toBe(0);
    expect(err.join('')).toBe('');
    const printed = out.join('');
    expect(printed).toContain('ok: piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-manylinux.whl METADATA Version=0.0.1\n');
    expect(printed).toContain('ok: piot_fixture_zzz_python_hatch-0.0.1.tar.gz PKG-INFO Version=0.0.1\n');
  });

  it('still fails a version that is not on TestPyPI, and names it as unpublished', async () => {
    stubReaddir();
    stubStaleSimpleIndex();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(404, '{}'))));

    await expect(withFakeTimers(() => verify('metadata'))).resolves.toBe(1);
    const printed = out.join('') + err.join('');
    // The distinction the old gate could not draw: a version the registry has
    // never seen is a broken publish, not a slow index.
    expect(printed).toContain('piot-fixture-zzz-python-maturin==0.0.1 is not published to TestPyPI');
    expect(printed).not.toContain('index lag');
  });

  it('fails a release whose file list carries no wheel, without waiting out the budget', async () => {
    stubReaddir();
    stubStaleSimpleIndex();
    const sdistOnly = JSON.stringify({
      info: { version: '0.0.1' },
      urls: [
        {
          packagetype: 'sdist',
          filename: 'piot_fixture_zzz_python_maturin-0.0.1.tar.gz',
          url: 'https://test-files.pythonhosted.org/packages/cd/piot_fixture_zzz_python_maturin-0.0.1.tar.gz',
        },
      ],
    });
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, sdistOnly)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(withFakeTimers(() => verify('metadata'))).resolves.toBe(1);
    const printed = out.join('') + err.join('');
    // A published release missing an artifact is broken now and will still be
    // broken in ten minutes, so it must not consume the lag budget.
    expect(printed).toContain('piot-fixture-zzz-python-maturin==0.0.1 is published to TestPyPI but its release lists no wheel');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
