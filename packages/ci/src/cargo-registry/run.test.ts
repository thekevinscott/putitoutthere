/**
 * Dispatch test for the cargo-registry mode router (#454). Mocks the two
 * composition roots so this isolates routing: `start` / `diagnose` reach their
 * gate and return its code; an unknown/missing mode fails with the exact error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCargoRegistryDiagnose } from './run-diagnose.js';
import { runCargoRegistryStart } from './run-start.js';
import { runCargoRegistry } from './run.js';

vi.mock('./run-start.js');
vi.mock('./run-diagnose.js');

const start = vi.mocked(runCargoRegistryStart);
const diagnose = vi.mocked(runCargoRegistryDiagnose);
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

const argv = (mode?: string) => ['node', 'piot-ci', 'cargo-registry', ...(mode === undefined ? [] : [mode])];

describe('runCargoRegistry dispatch', () => {
  it('routes start and returns its exit code', () => {
    start.mockReturnValue(0);
    expect(runCargoRegistry(argv('start'))).toBe(0);
    expect(start).toHaveBeenCalledOnce();
    expect(diagnose).not.toHaveBeenCalled();
  });

  it('routes diagnose and returns its exit code', () => {
    diagnose.mockReturnValue(0);
    expect(runCargoRegistry(argv('diagnose'))).toBe(0);
    expect(diagnose).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });

  it('rejects a missing mode', () => {
    expect(runCargoRegistry(argv())).toBe(1);
    expect(out.join('')).toBe('::error::cargo-registry: mode must be one of start|diagnose (got <none>).\n');
    expect(start).not.toHaveBeenCalled();
    expect(diagnose).not.toHaveBeenCalled();
  });

  it('rejects an unknown mode, echoing the bad value', () => {
    expect(runCargoRegistry(argv('restart'))).toBe(1);
    expect(out.join('')).toBe('::error::cargo-registry: mode must be one of start|diagnose (got restart).\n');
  });
});
