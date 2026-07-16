/**
 * `extractCrate` (#449): unpacks a gzipped tar (`.crate`) into a fresh temp
 * dir. Isolated: `node:fs/promises` (`mkdtemp`) and the process seam
 * (`execCapture`) are mocked, so the unit is exercised without a real
 * archive or a real `tar` subprocess — this test asserts the wiring (a fresh
 * temp dir returned, `tar -xzf … -C <dir>` invoked). Real tar extraction is
 * covered by tests/integration/verify-crate.integration.test.ts and e2e.
 */

import { mkdtemp } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractCrate } from './extract-crate.js';
import { execCapture } from '../../utils/exec-capture.js';

vi.mock('../../utils/exec-capture.js');
vi.mock('node:fs/promises');

const mkdtempMock = vi.mocked(mkdtemp);
const execMock = vi.mocked(execCapture);

beforeEach(() => {
  vi.clearAllMocks();
  execMock.mockResolvedValue({ stdout: '', stderr: '' });
});

describe('extractCrate', () => {
  it('extracts the archive into a fresh dir via tar -xzf … -C <dir>', async () => {
    mkdtempMock.mockResolvedValue('/tmp/piot-crate-abc');

    const dir = await extractCrate('/reg/demo-1.0.0.crate');

    expect(dir).toBe('/tmp/piot-crate-abc');
    expect(execMock).toHaveBeenCalledWith('tar', [
      '-xzf',
      '/reg/demo-1.0.0.crate',
      '-C',
      '/tmp/piot-crate-abc',
    ]);
  });

  it('returns a fresh directory distinct on each call', async () => {
    mkdtempMock.mockResolvedValueOnce('/tmp/piot-crate-a').mockResolvedValueOnce('/tmp/piot-crate-b');

    const a = await extractCrate('/reg/demo-2.0.0.crate');
    const b = await extractCrate('/reg/demo-2.0.0.crate');

    expect(a).not.toBe(b);
  });
});
