/**
 * `extractCrate` (#449): unpacks a gzipped tar (`.crate`) into a fresh temp
 * dir. Isolated: `node:fs` (`mkdtempSync`) and `node:child_process`
 * (`execFileSync`) are mocked, so the unit is exercised without a real
 * archive or a real `tar` subprocess — this test asserts the wiring (a fresh
 * temp dir returned, `tar -xzf … -C <dir>` invoked). Real tar extraction is
 * covered by tests/integration/verify-crate.integration.test.ts and e2e.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractCrate } from './extract-crate.js';

vi.mock('node:child_process');
vi.mock('node:fs');

const mkdtemp = vi.mocked(mkdtempSync);
const execFile = vi.mocked(execFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractCrate', () => {
  it('extracts the archive into a fresh dir via tar -xzf … -C <dir>', () => {
    mkdtemp.mockReturnValue('/tmp/piot-crate-abc');

    const dir = extractCrate('/reg/demo-1.0.0.crate');

    expect(dir).toBe('/tmp/piot-crate-abc');
    expect(execFile).toHaveBeenCalledWith('tar', [
      '-xzf',
      '/reg/demo-1.0.0.crate',
      '-C',
      '/tmp/piot-crate-abc',
    ]);
  });

  it('returns a fresh directory distinct on each call', () => {
    mkdtemp.mockReturnValueOnce('/tmp/piot-crate-a').mockReturnValueOnce('/tmp/piot-crate-b');

    const a = extractCrate('/reg/demo-2.0.0.crate');
    const b = extractCrate('/reg/demo-2.0.0.crate');

    expect(a).not.toBe(b);
  });
});
