/**
 * Composition-root wiring test for cargo-registry `diagnose` (#454). Mocks the
 * OS boundary (`node:child_process`), `./read-raw.js`, and `./diagnose-output.js`,
 * isolating the plumbing: the exact probe curl, the fallback to curl's partial
 * stdout on failure, the raw log/config reads, and the assembled dump. Never
 * fails (exit 0), matching the bash `set +e`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';
import { diagnoseOutput } from './diagnose-output.js';
import { readRaw } from './read-raw.js';
import { runCargoRegistryDiagnose } from './run-diagnose.js';

vi.mock('../utils/exec-capture.js');
vi.mock('./read-raw.js');
vi.mock('./diagnose-output.js');

const exec = vi.mocked(execCapture);
const readRawMock = vi.mocked(readRaw);
const diagnose = vi.mocked(diagnoseOutput);
const out: string[] = [];

const ENDPOINT = 'http://127.0.0.1:35503/git/info/refs?service=git-upload-pack';
const PROBE_ARGS = ['-sS', '-o', '/dev/null', '-w', 'GET /git/info/refs?service=git-upload-pack -> %{http_code}\\n', ENDPOINT];

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  process.env.RUNNER_TEMP = '/rt';
  process.env.HOME = '/home/piot';
  diagnose.mockReturnValue('DUMP');
  readRawMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RUNNER_TEMP;
  delete process.env.HOME;
});

describe('runCargoRegistryDiagnose', () => {
  it('probes the endpoint, reads the log + config, and prints the assembled dump', async () => {
    exec.mockResolvedValue({ stdout: 'GET /git/info/refs?service=git-upload-pack -> 200\n', stderr: '' });
    readRawMock.mockImplementation((p) => Promise.resolve(p === '/rt/cargo-http-registry.log' ? 'LOG' : 'CONFIG'));
    const code = await runCargoRegistryDiagnose();

    expect(code).toBe(0);
    expect(exec).toHaveBeenCalledWith('curl', PROBE_ARGS);
    expect(readRawMock).toHaveBeenNthCalledWith(1, '/rt/cargo-http-registry.log');
    expect(readRawMock).toHaveBeenNthCalledWith(2, '/home/piot/.cargo/config.toml');
    expect(diagnose).toHaveBeenCalledWith({
      logRaw: 'LOG',
      probeRaw: 'GET /git/info/refs?service=git-upload-pack -> 200\n',
      configRaw: 'CONFIG',
    });
    expect(out.join('')).toBe('DUMP');
  });

  it('falls back to curl’s partial stdout when the probe throws', async () => {
    exec.mockRejectedValue(new ExecError('curl 7', '', '', 7));
    await runCargoRegistryDiagnose();
    expect(diagnose).toHaveBeenCalledWith(expect.objectContaining({ probeRaw: '' }));
  });

  it('uses empty string when the thrown error has no stdout', async () => {
    exec.mockRejectedValue(new Error('curl 7'));
    await runCargoRegistryDiagnose();
    expect(diagnose).toHaveBeenCalledWith(expect.objectContaining({ probeRaw: '' }));
  });

  it('reads relative to an empty base when RUNNER_TEMP / HOME are unset', async () => {
    delete process.env.RUNNER_TEMP;
    delete process.env.HOME;
    exec.mockResolvedValue({ stdout: '', stderr: '' });
    await runCargoRegistryDiagnose();
    expect(readRawMock).toHaveBeenNthCalledWith(1, '/cargo-http-registry.log');
    expect(readRawMock).toHaveBeenNthCalledWith(2, '/.cargo/config.toml');
  });
});
