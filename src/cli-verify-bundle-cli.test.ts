/**
 * CLI wiring for `verify bundle-cli` (#451): the subcommand dispatch and its
 * required flags. The engine function is mocked — this asserts routing, not
 * its behavior (covered in `verify/bundle-cli/index.test.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./verify/bundle-cli/index.js', () => ({ verifyBundleCli: vi.fn().mockReturnValue(0) }));
vi.mock('./verify/posture.js', () => ({ computeVerify: vi.fn().mockResolvedValue([]) }));

import { parseFlags, run } from './cli.js';
import { verifyBundleCli } from './verify/bundle-cli/index.js';

const bundleMock = vi.mocked(verifyBundleCli);
const stderr: string[] = [];

beforeEach(() => {
  bundleMock.mockReset().mockReturnValue(0);
  stderr.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    stderr.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseFlags: verify bundle-cli flags', () => {
  it('parses --stage-to and --bin', () => {
    const flags = parseFlags(['--stage-to', 'dirsql/_binary', '--bin', 'dirsql']);
    expect(flags.stageTo).toBe('dirsql/_binary');
    expect(flags.bin).toBe('dirsql');
  });

  it('leaves stageTo and bin unset by default', () => {
    const flags = parseFlags([]);
    expect(flags.stageTo).toBeUndefined();
    expect(flags.bin).toBeUndefined();
  });
});

describe('run: verify bundle-cli dispatch', () => {
  it('routes `verify bundle-cli` to the engine with path/stage-to/bin/target', async () => {
    const code = await run([
      'node', 'piot', 'verify', 'bundle-cli',
      '--path', 'pkg', '--stage-to', 'dirsql/_binary', '--bin', 'dirsql', '--target', 'sdist', '--cwd', '/x',
    ]);
    expect(code).toBe(0);
    expect(bundleMock).toHaveBeenCalledWith({
      cwd: '/x', path: 'pkg', stageTo: 'dirsql/_binary', bin: 'dirsql', target: 'sdist',
    });
  });

  it('errors when --path is missing', async () => {
    const code = await run(['node', 'piot', 'verify', 'bundle-cli', '--stage-to', 's', '--bin', 'b', '--target', 't']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('verify bundle-cli requires --path');
    expect(bundleMock).not.toHaveBeenCalled();
  });

  it('errors when --stage-to is missing', async () => {
    const code = await run(['node', 'piot', 'verify', 'bundle-cli', '--path', 'pkg', '--bin', 'b', '--target', 't']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('verify bundle-cli requires --stage-to');
    expect(bundleMock).not.toHaveBeenCalled();
  });

  it('errors when --bin is missing', async () => {
    const code = await run(['node', 'piot', 'verify', 'bundle-cli', '--path', 'pkg', '--stage-to', 's', '--target', 't']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('verify bundle-cli requires --bin');
    expect(bundleMock).not.toHaveBeenCalled();
  });

  it('errors when --target is missing', async () => {
    const code = await run(['node', 'piot', 'verify', 'bundle-cli', '--path', 'pkg', '--stage-to', 's', '--bin', 'b']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('verify bundle-cli requires --target');
    expect(bundleMock).not.toHaveBeenCalled();
  });
});
