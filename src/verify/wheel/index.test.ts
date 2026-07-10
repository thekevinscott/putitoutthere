/**
 * `verifyWheel` orchestrator (#450). The file-finding and zip-reading
 * helpers are mocked so this pins the branching / output / exit codes;
 * their real behaviour is covered in `find-dist-file.test.ts` and
 * `read-wheel-version.test.ts`, and end-to-end in the integration + e2e
 * tiers. A real temp `dist/` dir drives the existence check.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./find-dist-file.js', () => ({ findDistFile: vi.fn() }));
vi.mock('./read-wheel-version.js', () => ({ readWheelVersion: vi.fn() }));

import { verifyWheel } from './index.js';
import { findDistFile } from './find-dist-file.js';
import { readWheelVersion } from './read-wheel-version.js';

const findMock = vi.mocked(findDistFile);
const readMock = vi.mocked(readWheelVersion);

let pkg: string;
const out: string[] = [];

beforeEach(() => {
  pkg = mkdtempSync(join(tmpdir(), 'piot-wheel-orch-'));
  mkdirSync(join(pkg, 'dist'));
  out.length = 0;
  findMock.mockReset();
  readMock.mockReset();
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(pkg, { recursive: true, force: true });
});

const opts = (over: Partial<{ path: string; version: string; target: string }> = {}) => ({
  cwd: '/unused', path: pkg, version: '1.2.3', target: 'x86_64-unknown-linux-gnu', ...over,
});

describe('verifyWheel: dist presence', () => {
  it('fails when <path>/dist does not exist', () => {
    const code = verifyWheel(opts({ path: join(pkg, 'no-such-pkg') }));
    expect(out.join('')).toContain('no dist/ produced under');
    expect(code).toBe(1);
  });

  it('resolves a relative --path against cwd', () => {
    // A relative path exercises the resolve(cwd, path) branch; it resolves
    // under a cwd with no dist, so it reports the missing dist.
    const code = verifyWheel(opts({ path: 'rel/pkg' }));
    expect(out.join('')).toContain('no dist/ produced under');
    expect(code).toBe(1);
  });

  it('fails when <path>/dist exists but is a file, not a directory', () => {
    const p = mkdtempSync(join(tmpdir(), 'piot-wheel-distfile-'));
    writeFileSync(join(p, 'dist'), 'not a dir');
    try {
      const code = verifyWheel(opts({ path: p }));
      expect(out.join('')).toContain('no dist/ produced under');
      expect(code).toBe(1);
    } finally {
      rmSync(p, { recursive: true, force: true });
    }
  });
});

describe('verifyWheel: wheel METADATA', () => {
  it('passes when the wheel METADATA version matches', () => {
    findMock.mockReturnValue(join(pkg, 'dist', 'demo-1.2.3-cp312-cp312-linux_x86_64.whl'));
    readMock.mockReturnValue('1.2.3');
    const code = verifyWheel(opts());
    expect(out.join('')).toContain('ok wheel: demo-1.2.3-cp312-cp312-linux_x86_64.whl METADATA Version=1.2.3');
    expect(code).toBe(0);
  });

  it('fails on a version mismatch', () => {
    findMock.mockReturnValue(join(pkg, 'dist', 'demo-1.2.3-cp312-cp312-linux_x86_64.whl'));
    readMock.mockReturnValue('0.9.0');
    const code = verifyWheel(opts());
    expect(out.join('')).toContain("wheel METADATA Version='0.9.0' but plan='1.2.3'");
    expect(code).toBe(1);
  });

  it('fails (empty actual) when METADATA has no Version line', () => {
    findMock.mockReturnValue(join(pkg, 'dist', 'demo.whl'));
    readMock.mockReturnValue(null);
    const code = verifyWheel(opts());
    expect(out.join('')).toContain("wheel METADATA Version='' but plan='1.2.3'");
    expect(code).toBe(1);
  });

  it('fails when no wheel is produced', () => {
    findMock.mockReturnValue(null);
    const code = verifyWheel(opts());
    expect(out.join('')).toContain('no wheel produced in');
    expect(code).toBe(1);
  });
});

describe('verifyWheel: sdist filename', () => {
  it('passes when the sdist filename carries the version', () => {
    findMock.mockReturnValue(join(pkg, 'dist', 'demo-1.2.3.tar.gz'));
    const code = verifyWheel(opts({ target: 'sdist' }));
    expect(out.join('')).toContain('ok sdist: demo-1.2.3.tar.gz');
    expect(code).toBe(0);
    expect(readMock).not.toHaveBeenCalled();
  });

  it('fails when the sdist filename lacks the version', () => {
    findMock.mockReturnValue(join(pkg, 'dist', 'demo-0.9.0.tar.gz'));
    const code = verifyWheel(opts({ target: 'sdist' }));
    expect(out.join('')).toContain("does not contain planned version '1.2.3'");
    expect(code).toBe(1);
  });

  it('fails when no sdist is produced', () => {
    findMock.mockReturnValue(null);
    const code = verifyWheel(opts({ target: 'sdist' }));
    expect(out.join('')).toContain('no sdist produced in');
    expect(code).toBe(1);
  });
});
