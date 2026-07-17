/**
 * CLI wiring for the tag-plumbing commands (#446): dispatch routes each to
 * its engine function with the parsed `--cwd` / `--subject`, and the exit
 * code is passed through. Isolated per the unit-suite convention: each
 * engine is bare-automocked so the double can't drift from the source, and
 * the dispatcher under test (`./cli.js`) is loaded via dynamic import so
 * the mocks are in place first. This asserts routing, not behavior
 * (covered in the colocated engine tests and the e2e-cli tier).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./advance-v0.js');
vi.mock('./advance-floating-major.js');
vi.mock('./fold-action-bundle.js');

import { advanceFloatingMajor } from './advance-floating-major.js';
import { advanceV0 } from './advance-v0.js';
import { foldActionBundle } from './fold-action-bundle.js';

const advanceV0Mock = vi.mocked(advanceV0);
const advanceFloatingMajorMock = vi.mocked(advanceFloatingMajor);
const foldActionBundleMock = vi.mocked(foldActionBundle);

beforeEach(() => {
  advanceV0Mock.mockReset().mockResolvedValue(0);
  advanceFloatingMajorMock.mockReset().mockResolvedValue(0);
  foldActionBundleMock.mockReset().mockResolvedValue(0);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('run: tag-plumbing dispatch', () => {
  it('routes `advance-v0` to the engine with the parsed --cwd', async () => {
    const { run } = await import('./cli.js');
    const code = await run(['node', 'piot', 'advance-v0', '--cwd', '/x']);
    expect(code).toBe(0);
    expect(advanceV0Mock).toHaveBeenCalledWith({ cwd: '/x' });
  });

  it('routes `advance-floating-major` to the engine with the parsed --cwd', async () => {
    const { run } = await import('./cli.js');
    const code = await run(['node', 'piot', 'advance-floating-major', '--cwd', '/x']);
    expect(code).toBe(0);
    expect(advanceFloatingMajorMock).toHaveBeenCalledWith({ cwd: '/x' });
  });

  it('routes `fold-bundle` to the engine with --cwd and --subject', async () => {
    const { run } = await import('./cli.js');
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
    const { run } = await import('./cli.js');
    const code = await run(['node', 'piot', 'fold-bundle', '--cwd', '/x']);
    expect(code).toBe(1);
    expect(foldActionBundleMock).not.toHaveBeenCalled();
  });
});
