/**
 * CLI wiring for `verify crate` (#449): the subcommand dispatch and its
 * required flags. The engine function is mocked — this asserts routing, not
 * its behavior (covered in `verify/crate/index.test.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./verify/crate/index.js', () => ({ verifyCrate: vi.fn().mockReturnValue(0) }));
vi.mock('./verify/posture.js', () => ({ computeVerify: vi.fn().mockResolvedValue([]) }));

import { parseFlags, run } from './cli.js';
import { verifyCrate } from './verify/crate/index.js';

const crateMock = vi.mocked(verifyCrate);
const stderr: string[] = [];

beforeEach(() => {
  crateMock.mockReset().mockReturnValue(0);
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

describe('parseFlags: verify crate flags', () => {
  it('parses --registry-root', () => {
    expect(parseFlags(['--registry-root', '/reg']).registryRoot).toBe('/reg');
  });

  it('leaves registryRoot unset by default', () => {
    expect(parseFlags([]).registryRoot).toBeUndefined();
  });
});

describe('run: verify crate dispatch', () => {
  it('routes `verify crate` to the engine with matrix + registry-root', async () => {
    const code = await run([
      'node', 'piot', 'verify', 'crate', '--matrix', '[]', '--registry-root', '/reg', '--cwd', '/x',
    ]);
    expect(code).toBe(0);
    expect(crateMock).toHaveBeenCalledWith({ matrix: '[]', registryRoot: '/reg' });
  });

  it('errors when --matrix is missing', async () => {
    const code = await run(['node', 'piot', 'verify', 'crate', '--registry-root', '/reg']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('verify crate requires --matrix');
    expect(crateMock).not.toHaveBeenCalled();
  });

  it('errors when --registry-root is missing', async () => {
    const code = await run(['node', 'piot', 'verify', 'crate', '--matrix', '[]']);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('verify crate requires --registry-root');
    expect(crateMock).not.toHaveBeenCalled();
  });
});
