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
// for real and mock only the Node built-ins underneath: `execFile` (what
// `execCapture` uses, for curl/unzip/tar) and `spawn` (what `execInherit`
// uses, for the pip download). Every artifact resolves on the first attempt,
// so the retry `sleep` is never reached — leaving `sleep` un-mocked (mocking
// it would trip the testing-conventions `no-first-party-mock` gate) is safe.
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
  delete process.env.TESTPYPI_INDEX_URL;
});

const verify = (mode: string): Promise<number> => run(['node', 'piot-ci', 'testpypi-verify', mode]);

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
