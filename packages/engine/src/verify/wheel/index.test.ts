/**
 * `verifyWheel` orchestrator (#450). `node:fs/promises` and the file-finding /
 * zip-reading helpers are mocked so this pins the branching / output / exit
 * codes in isolation; their real behaviour is covered in
 * `find-dist-file.test.ts` and `read-wheel-version.test.ts`, and end-to-end in
 * the integration + e2e tiers. The dist-presence check is driven through the
 * mocked `stat` (also backing `pathExists`).
 */

import { stat } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyWheel } from './index.js';
import { findDistFile } from './find-dist-file.js';
import { readWheelVersion } from './read-wheel-version.js';

vi.mock('node:fs/promises');
vi.mock('./find-dist-file.js');
vi.mock('./read-wheel-version.js');

const statMock = vi.mocked(stat);
const findMock = vi.mocked(findDistFile);
const readMock = vi.mocked(readWheelVersion);

// `pathExists` returns false when `stat` rejects; ENOENT drives the
// missing-dist branch.
const ENOENT = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

const pkg = '/pkg';
const out: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  // `stat` serves both `pathExists` (resolves ⇒ present) and the
  // `isDirectory` check; the default is a present directory.
  statMock.mockResolvedValue({ isDirectory: () => true } as never);
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const opts = (over: Partial<{ path: string; version: string; target: string }> = {}) => ({
  cwd: '/unused', path: pkg, version: '1.2.3', target: 'x86_64-unknown-linux-gnu', ...over,
});

describe('verifyWheel: dist presence', () => {
  it('fails when <path>/dist does not exist', async () => {
    statMock.mockRejectedValue(ENOENT);
    const code = await verifyWheel(opts({ path: '/pkg/no-such-pkg' }));
    expect(out.join('')).toContain('no dist/ produced under');
    expect(code).toBe(1);
  });

  it('resolves a relative --path against cwd', async () => {
    // A relative path exercises the resolve(cwd, path) branch; the resolved
    // dist dir is reported in the missing-dist error, pinning the resolution.
    // Separator-agnostic so the assertion holds on Windows too (path.resolve
    // there yields backslashes and a drive letter).
    statMock.mockRejectedValue(ENOENT);
    const code = await verifyWheel(opts({ path: 'rel/pkg' }));
    expect(out.join('')).toMatch(/no dist\/ produced under .*[/\\]unused[/\\]rel[/\\]pkg[/\\]dist/);
    expect(code).toBe(1);
  });

  it('fails when <path>/dist exists but is a file, not a directory', async () => {
    statMock.mockResolvedValue({ isDirectory: () => false } as never);
    const code = await verifyWheel(opts());
    expect(out.join('')).toContain('no dist/ produced under');
    expect(code).toBe(1);
  });
});

describe('verifyWheel: wheel METADATA', () => {
  it('passes when the wheel METADATA version matches', async () => {
    findMock.mockResolvedValue('/pkg/dist/demo-1.2.3-cp312-cp312-linux_x86_64.whl');
    readMock.mockResolvedValue('1.2.3');
    const code = await verifyWheel(opts());
    expect(out.join('')).toContain('ok wheel: demo-1.2.3-cp312-cp312-linux_x86_64.whl METADATA Version=1.2.3');
    expect(code).toBe(0);
    // The wheel lookup searches for the `.whl` extension.
    expect(findMock).toHaveBeenCalledWith(expect.anything(), '.whl');
  });

  it('fails on a version mismatch', async () => {
    findMock.mockResolvedValue('/pkg/dist/demo-1.2.3-cp312-cp312-linux_x86_64.whl');
    readMock.mockResolvedValue('0.9.0');
    const code = await verifyWheel(opts());
    expect(out.join('')).toContain("wheel METADATA Version='0.9.0' but plan='1.2.3'");
    expect(code).toBe(1);
  });

  it('fails (empty actual) when METADATA has no Version line', async () => {
    findMock.mockResolvedValue('/pkg/dist/demo.whl');
    readMock.mockResolvedValue(null);
    const code = await verifyWheel(opts());
    expect(out.join('')).toContain("wheel METADATA Version='' but plan='1.2.3'");
    expect(code).toBe(1);
  });

  it('fails when no wheel is produced', async () => {
    findMock.mockResolvedValue(null);
    const code = await verifyWheel(opts());
    expect(out.join('')).toContain('no wheel produced in');
    expect(code).toBe(1);
  });
});

describe('verifyWheel: sdist filename', () => {
  it('passes when the sdist filename carries the version', async () => {
    findMock.mockResolvedValue('/pkg/dist/demo-1.2.3.tar.gz');
    const code = await verifyWheel(opts({ target: 'sdist' }));
    expect(out.join('')).toContain('ok sdist: demo-1.2.3.tar.gz');
    expect(code).toBe(0);
    expect(readMock).not.toHaveBeenCalled();
    // The sdist lookup searches for the `.tar.gz` extension.
    expect(findMock).toHaveBeenCalledWith(expect.anything(), '.tar.gz');
  });

  it('fails when the sdist filename lacks the version', async () => {
    findMock.mockResolvedValue('/pkg/dist/demo-0.9.0.tar.gz');
    const code = await verifyWheel(opts({ target: 'sdist' }));
    expect(out.join('')).toContain("does not contain planned version '1.2.3'");
    expect(code).toBe(1);
  });

  it('fails when no sdist is produced', async () => {
    findMock.mockResolvedValue(null);
    const code = await verifyWheel(opts({ target: 'sdist' }));
    expect(out.join('')).toContain('no sdist produced in');
    expect(code).toBe(1);
  });
});
