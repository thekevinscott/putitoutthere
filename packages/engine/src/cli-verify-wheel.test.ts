/**
 * CLI wiring for `verify wheel` (#450): subcommand dispatch and its required
 * flags. The engine function is mocked — this asserts routing, not behavior
 * (covered in `verify/wheel/index.test.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./verify/wheel/index.js', () => ({ verifyWheel: vi.fn().mockReturnValue(0) }));
vi.mock('./verify/posture.js', () => ({ computeVerify: vi.fn().mockResolvedValue([]) }));

import { parseFlags, run } from './cli.js';
import { verifyWheel } from './verify/wheel/index.js';

const wheelMock = vi.mocked(verifyWheel);
const stderr: string[] = [];

beforeEach(() => {
  wheelMock.mockReset().mockReturnValue(0);
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

describe('parseFlags: verify wheel flags', () => {
  it('parses --target', () => {
    expect(parseFlags(['--target', 'sdist']).target).toBe('sdist');
  });
});

describe('run: verify wheel dispatch', () => {
  it('routes `verify wheel` to the engine with path/version/target', async () => {
    const code = await run([
      'node', 'piot', 'verify', 'wheel', '--path', 'pkg', '--version', '1.2.3', '--target', 'sdist', '--cwd', '/x',
    ]);
    expect(code).toBe(0);
    expect(wheelMock).toHaveBeenCalledWith({ cwd: '/x', path: 'pkg', version: '1.2.3', target: 'sdist' });
  });

  it('errors when --path is missing', async () => {
    const code = await run(['node', 'piot', 'verify', 'wheel', '--version', '1.2.3', '--target', 'sdist']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('verify wheel requires --path');
    expect(wheelMock).not.toHaveBeenCalled();
  });

  it('errors when --version is missing', async () => {
    const code = await run(['node', 'piot', 'verify', 'wheel', '--path', 'pkg', '--target', 'sdist']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('verify wheel requires --version');
  });

  it('errors when --target is missing', async () => {
    const code = await run(['node', 'piot', 'verify', 'wheel', '--path', 'pkg', '--version', '1.2.3']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('verify wheel requires --target');
  });
});
