/**
 * Dispatch test for the pypi-tag-verify mode router. Mocks the two composition
 * roots so this isolates routing: `prepare` / `assert` reach their gate and
 * return its code; an unknown/missing mode fails with the exact error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runPypiTagAssert } from './run-assert.js';
import { runPypiTagPrepare } from './run-prepare.js';
import { runPypiTagVerify } from './run.js';

vi.mock('./run-assert.js');
vi.mock('./run-prepare.js');

const prepareGate = vi.mocked(runPypiTagPrepare);
const assertGate = vi.mocked(runPypiTagAssert);
const out: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const argv = (mode?: string) => [
  'node',
  'piot-ci',
  'pypi-tag-verify',
  ...(mode === undefined ? [] : [mode]),
];

describe('runPypiTagVerify dispatch', () => {
  it('routes prepare and returns its exit code', async () => {
    prepareGate.mockResolvedValue(7);
    await expect(runPypiTagVerify(argv('prepare'))).resolves.toBe(7);
    expect(prepareGate).toHaveBeenCalledOnce();
    expect(assertGate).not.toHaveBeenCalled();
  });

  it('routes assert and returns its exit code', async () => {
    assertGate.mockResolvedValue(9);
    await expect(runPypiTagVerify(argv('assert'))).resolves.toBe(9);
    expect(assertGate).toHaveBeenCalledOnce();
    expect(prepareGate).not.toHaveBeenCalled();
  });

  it('rejects a missing mode', async () => {
    await expect(runPypiTagVerify(argv())).resolves.toBe(1);
    expect(out.join('')).toBe(
      '::error::pypi-tag-verify: mode must be one of prepare|assert (got <none>).\n',
    );
    expect(prepareGate).not.toHaveBeenCalled();
    expect(assertGate).not.toHaveBeenCalled();
  });

  it('rejects an unknown mode, echoing the bad value', async () => {
    await expect(runPypiTagVerify(argv('tag'))).resolves.toBe(1);
    expect(out.join('')).toBe(
      '::error::pypi-tag-verify: mode must be one of prepare|assert (got tag).\n',
    );
  });
});
