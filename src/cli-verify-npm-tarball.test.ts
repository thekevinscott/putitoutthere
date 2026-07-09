/**
 * CLI wiring for the `verify` command family (#442/#443): the
 * `npm-tarball` subcommand dispatch, its flags, and the posture
 * fall-through. The engine functions are mocked — this asserts routing,
 * not their behavior (covered in their own suites).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./verify/npm-tarball/index.js', () => ({ verifyNpmTarball: vi.fn().mockResolvedValue(0) }));
vi.mock('./verify/posture.js', () => ({ computeVerify: vi.fn().mockResolvedValue([]) }));

import { parseFlags, run } from './cli.js';
import { computeVerify } from './verify/posture.js';
import { verifyNpmTarball } from './verify/npm-tarball/index.js';

const npmTarballMock = vi.mocked(verifyNpmTarball);
const computeVerifyMock = vi.mocked(computeVerify);
const stdout: string[] = [];
const stderr: string[] = [];

beforeEach(() => {
  npmTarballMock.mockReset().mockResolvedValue(0);
  computeVerifyMock.mockReset().mockResolvedValue([]);
  stdout.length = 0;
  stderr.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    stdout.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    stderr.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseFlags: verify npm-tarball flags', () => {
  it('parses --matrix, --registry and --per-triple', () => {
    const f = parseFlags(['--matrix', '[]', '--registry', 'http://r', '--per-triple']);
    expect(f.matrix).toBe('[]');
    expect(f.registry).toBe('http://r');
    expect(f.perTriple).toBe(true);
  });

  it('defaults perTriple to false and leaves matrix/registry unset', () => {
    const f = parseFlags([]);
    expect(f.perTriple).toBe(false);
    expect(f.matrix).toBeUndefined();
    expect(f.registry).toBeUndefined();
  });
});

describe('run: verify subcommand dispatch', () => {
  it('routes `verify npm-tarball` to the engine with parsed flags', async () => {
    const code = await run([
      'node', 'piot', 'verify', 'npm-tarball',
      '--matrix', '[]', '--registry', 'http://r', '--per-triple', '--cwd', '/x',
    ]);
    expect(code).toBe(0);
    expect(npmTarballMock).toHaveBeenCalledWith({
      cwd: '/x', matrix: '[]', registry: 'http://r', perTriple: true,
    });
    expect(computeVerifyMock).not.toHaveBeenCalled();
  });

  it('errors when `verify npm-tarball` is missing --matrix', async () => {
    const code = await run(['node', 'piot', 'verify', 'npm-tarball', '--cwd', '/x']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('verify npm-tarball requires --matrix');
    expect(npmTarballMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown verify subcommand', async () => {
    const code = await run(['node', 'piot', 'verify', 'frobnicate', '--cwd', '/x']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('unknown verify subcommand: frobnicate');
  });

  it('bare `verify` still runs the posture check', async () => {
    const code = await run(['node', 'piot', 'verify', '--cwd', '/x']);
    expect(code).toBe(0);
    expect(computeVerifyMock).toHaveBeenCalledOnce();
    expect(npmTarballMock).not.toHaveBeenCalled();
  });

  it('`verify --json` (leading-flag positional) still routes to posture', async () => {
    const code = await run(['node', 'piot', 'verify', '--json', '--cwd', '/x']);
    expect(code).toBe(0);
    expect(computeVerifyMock).toHaveBeenCalledOnce();
  });
});
