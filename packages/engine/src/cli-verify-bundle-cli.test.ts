/**
 * CLI wiring for `verify bundle-cli` (#451): the subcommand dispatch and its
 * required flags. Isolated per the unit-suite convention: the engine
 * (`./verify/bundle-cli/index.js`) and the posture fall-through
 * (`./verify/posture.js`) are bare-automocked so the doubles can't drift
 * from the source, and the dispatcher under test (`./cli.js`) is loaded via
 * dynamic import so the mocks are in place first. This asserts routing, not
 * engine behavior (covered in `verify/bundle-cli/index.test.ts` and the
 * e2e-cli tier).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./verify/bundle-cli/index.js');
vi.mock('./verify/posture.js');

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
  it('parses --stage-to and --bin', async () => {
    const { parseFlags } = await import('./cli.js');
    const flags = parseFlags(['--stage-to', 'dirsql/_binary', '--bin', 'dirsql']);
    expect(flags.stageTo).toBe('dirsql/_binary');
    expect(flags.bin).toBe('dirsql');
  });

  it('leaves stageTo and bin unset by default', async () => {
    const { parseFlags } = await import('./cli.js');
    const flags = parseFlags([]);
    expect(flags.stageTo).toBeUndefined();
    expect(flags.bin).toBeUndefined();
  });
});

describe('run: verify bundle-cli dispatch', () => {
  it('routes `verify bundle-cli` to the engine with path/stage-to/bin/target', async () => {
    const { run } = await import('./cli.js');
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
    const { run } = await import('./cli.js');
    const code = await run(['node', 'piot', 'verify', 'bundle-cli', '--stage-to', 's', '--bin', 'b', '--target', 't']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('verify bundle-cli requires --path');
    expect(bundleMock).not.toHaveBeenCalled();
  });

  it('errors when --stage-to is missing', async () => {
    const { run } = await import('./cli.js');
    const code = await run(['node', 'piot', 'verify', 'bundle-cli', '--path', 'pkg', '--bin', 'b', '--target', 't']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('verify bundle-cli requires --stage-to');
    expect(bundleMock).not.toHaveBeenCalled();
  });

  it('errors when --bin is missing', async () => {
    const { run } = await import('./cli.js');
    const code = await run(['node', 'piot', 'verify', 'bundle-cli', '--path', 'pkg', '--stage-to', 's', '--target', 't']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('verify bundle-cli requires --bin');
    expect(bundleMock).not.toHaveBeenCalled();
  });

  it('errors when --target is missing', async () => {
    const { run } = await import('./cli.js');
    const code = await run(['node', 'piot', 'verify', 'bundle-cli', '--path', 'pkg', '--stage-to', 's', '--bin', 'b']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('verify bundle-cli requires --target');
    expect(bundleMock).not.toHaveBeenCalled();
  });
});
