/**
 * Integration test for the TestPyPI verify/assert harness (#455, epic #442).
 *
 * Drives the real `piot-ci testpypi-verify <mode>` dispatch in-process — `run()`
 * → `runTestpypiVerify` → `runTestpypiAssert` / `runTestpypiMetadata` and every
 * real decision (requirements build, simple-index parse, member selection,
 * version match) — with only the OS/network boundary (`node:child_process`,
 * `node:fs`) mocked. Unlike the colocated `*.test.ts` wiring tests (which mock
 * the decisions), this exercises the genuine parsing/matching, so the mock
 * cannot silently disagree with the pure cores.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

vi.mock('node:child_process');
vi.mock('node:fs');

const exec = vi.mocked(execFileSync);
const readdir = vi.mocked(readdirSync);
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
  process.env.TESTPYPI_INDEX_URL = 'https://test.pypi.org/simple/';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TESTPYPI_INDEX_URL;
});

const verify = (mode: string): number => run(['node', 'piot-ci', 'testpypi-verify', mode]);

describe('piot-ci testpypi-verify (integration)', () => {
  it('assert: prints the sorted dist listing and exits 0 when every artifact exists', () => {
    readdir.mockReturnValue(DIST_FILES.map(fileDirent) as unknown as ReturnType<typeof readdirSync>);
    expect(verify('assert')).toBe(0);
    expect(out.join('')).toBe(
      'dist/piot_fixture_zzz_python_hatch-0.0.1-py3-none-any.whl\n' +
        'dist/piot_fixture_zzz_python_hatch-0.0.1.tar.gz\n' +
        'dist/piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-manylinux.whl\n' +
        'dist/piot_fixture_zzz_python_maturin-0.0.1.tar.gz\n',
    );
  });

  it('assert: fails with the exact error when a fixture wheel is missing', () => {
    readdir.mockReturnValue(
      DIST_FILES.filter((name) => name !== 'piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-manylinux.whl').map(
        fileDirent,
      ) as unknown as ReturnType<typeof readdirSync>,
    );
    expect(verify('assert')).toBe(1);
    expect(out.join('')).toContain('::error::missing piot_fixture_zzz_python_maturin wheel artifact for TestPyPI');
  });

  it('metadata: downloads and verifies both fixtures end to end', () => {
    readdir.mockImplementation(((dir: string) => {
      if (dir === 'dist') {
        return DIST_FILES.map(fileDirent);
      }
      if (dir === 'downloaded-wheels') {
        return [
          'piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-manylinux.whl',
          'piot_fixture_zzz_python_hatch-0.0.1-py3-none-any.whl',
        ];
      }
      return ['piot_fixture_zzz_python_maturin-0.0.1.tar.gz', 'piot_fixture_zzz_python_hatch-0.0.1.tar.gz'];
    }) as unknown as typeof readdirSync);

    exec.mockImplementation((cmd: string, args?: readonly string[]) => {
      const a = args ?? [];
      if (cmd === 'python' || cmd === 'sleep') {
        return '';
      }
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

    expect(verify('metadata')).toBe(0);
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
