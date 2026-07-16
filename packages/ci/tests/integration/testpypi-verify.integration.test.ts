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

import { readdir } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';
import { execCapture } from '../../src/utils/exec-capture.js';
import { execInherit } from '../../src/utils/exec-inherit.js';
import { sleep } from '../../src/utils/sleep.js';

vi.mock('node:fs/promises');
vi.mock('../../src/utils/exec-capture.js');
vi.mock('../../src/utils/exec-inherit.js');
vi.mock('../../src/utils/sleep.js');

const capture = vi.mocked(execCapture);
const inherit = vi.mocked(execInherit);
const readdirMock = vi.mocked(readdir);
let out: string[];
let err: string[];

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
  vi.mocked(sleep).mockResolvedValue(undefined);
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

    inherit.mockResolvedValue(undefined); // pip download

    capture.mockImplementation((cmd: string, args?: readonly string[]) => {
      const a = args ?? [];
      if (cmd === 'curl') {
        if (a[1] === '-o') {
          return Promise.resolve({ stdout: '', stderr: '' });
        }
        const file = `${stemOf(a[1] ?? '')}-0.0.1.tar.gz`;
        return Promise.resolve({
          stdout: `<html><body><a href="https://files/${file}#sha256=z">${file}</a></body></html>`,
          stderr: '',
        });
      }
      if (cmd === 'unzip' && a[0] === '-Z1') {
        return Promise.resolve({
          stdout: `${stemOf(a[1] ?? '')}-0.0.1.dist-info/METADATA\n${stemOf(a[1] ?? '')}-0.0.1.dist-info/RECORD\n`,
          stderr: '',
        });
      }
      if (cmd === 'tar' && a[0] === '-tzf') {
        return Promise.resolve({
          stdout: `${stemOf(a[1] ?? '')}-0.0.1/PKG-INFO\n${stemOf(a[1] ?? '')}-0.0.1/setup.py\n`,
          stderr: '',
        });
      }
      // unzip -p / tar -xzOf: the metadata blob
      return Promise.resolve({ stdout: 'Name: x\nVersion: 0.0.1\n', stderr: '' });
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
