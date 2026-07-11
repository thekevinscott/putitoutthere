/**
 * CLI wiring for the tag-plumbing commands (#446): dispatch routes each to
 * its engine function with the parsed `--cwd` / `--subject`, and the exit
 * code is passed through. The engines are mocked — this asserts routing,
 * not behavior (covered in the colocated engine tests).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./advance-v0.js', () => ({ advanceV0: vi.fn().mockReturnValue(0) }));
vi.mock('./advance-floating-major.js', () => ({ advanceFloatingMajor: vi.fn().mockReturnValue(0) }));
vi.mock('./fold-action-bundle.js', () => ({ foldActionBundle: vi.fn().mockReturnValue(0) }));

import { advanceFloatingMajor } from './advance-floating-major.js';
import { advanceV0 } from './advance-v0.js';
import { run } from './cli.js';
import { foldActionBundle } from './fold-action-bundle.js';

const advanceV0Mock = vi.mocked(advanceV0);
const advanceFloatingMajorMock = vi.mocked(advanceFloatingMajor);
const foldActionBundleMock = vi.mocked(foldActionBundle);

beforeEach(() => {
  advanceV0Mock.mockReset().mockReturnValue(0);
  advanceFloatingMajorMock.mockReset().mockReturnValue(0);
  foldActionBundleMock.mockReset().mockReturnValue(0);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('run: tag-plumbing dispatch', () => {
  it('routes `advance-v0` to the engine with the parsed --cwd', async () => {
    const code = await run(['node', 'piot', 'advance-v0', '--cwd', '/x']);
    expect(code).toBe(0);
    expect(advanceV0Mock).toHaveBeenCalledWith({ cwd: '/x' });
  });

  it('routes `advance-floating-major` to the engine with the parsed --cwd', async () => {
    const code = await run(['node', 'piot', 'advance-floating-major', '--cwd', '/x']);
    expect(code).toBe(0);
    expect(advanceFloatingMajorMock).toHaveBeenCalledWith({ cwd: '/x' });
  });

  it('routes `fold-bundle` to the engine with --cwd and --subject', async () => {
    const code = await run([
      'node', 'piot', 'fold-bundle', '--cwd', '/x', '--subject', 'chore(release): bundle action',
    ]);
    expect(code).toBe(0);
    expect(foldActionBundleMock).toHaveBeenCalledWith({
      cwd: '/x',
      subject: 'chore(release): bundle action',
    });
  });

  it('rejects `fold-bundle` without --subject (exit 1, engine untouched)', async () => {
    const code = await run(['node', 'piot', 'fold-bundle', '--cwd', '/x']);
    expect(code).toBe(1);
    expect(foldActionBundleMock).not.toHaveBeenCalled();
  });
});
