/**
 * Dispatch test for the testpypi-verify mode router. Mocks the two composition
 * roots so this isolates routing: `assert` / `metadata` reach their gate and
 * return its code; an unknown/missing mode fails with the exact error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runTestpypiAssert } from './run-assert.js';
import { runTestpypiMetadata } from './run-metadata.js';
import { runTestpypiVerify } from './run.js';

vi.mock('./run-assert.js');
vi.mock('./run-metadata.js');

const assertGate = vi.mocked(runTestpypiAssert);
const metadataGate = vi.mocked(runTestpypiMetadata);
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

const argv = (mode?: string) => ['node', 'piot-ci', 'testpypi-verify', ...(mode === undefined ? [] : [mode])];

describe('runTestpypiVerify dispatch', () => {
  it('routes assert and returns its exit code', async () => {
    assertGate.mockResolvedValue(7);
    await expect(runTestpypiVerify(argv('assert'))).resolves.toBe(7);
    expect(assertGate).toHaveBeenCalledOnce();
    expect(metadataGate).not.toHaveBeenCalled();
  });

  it('routes metadata and returns its exit code', async () => {
    metadataGate.mockResolvedValue(9);
    await expect(runTestpypiVerify(argv('metadata'))).resolves.toBe(9);
    expect(metadataGate).toHaveBeenCalledOnce();
    expect(assertGate).not.toHaveBeenCalled();
  });

  it('rejects a missing mode', async () => {
    await expect(runTestpypiVerify(argv())).resolves.toBe(1);
    expect(out.join('')).toBe('::error::testpypi-verify: mode must be one of assert|metadata (got <none>).\n');
    expect(assertGate).not.toHaveBeenCalled();
    expect(metadataGate).not.toHaveBeenCalled();
  });

  it('rejects an unknown mode, echoing the bad value', async () => {
    await expect(runTestpypiVerify(argv('verify'))).resolves.toBe(1);
    expect(out.join('')).toBe('::error::testpypi-verify: mode must be one of assert|metadata (got verify).\n');
  });
});
