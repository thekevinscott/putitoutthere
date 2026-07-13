/**
 * Composition-root wiring test for cargo-registry `diagnose` (#454). Mocks the
 * OS boundary (`node:child_process`), `./read-raw.js`, and `./diagnose-output.js`,
 * isolating the plumbing: the exact probe curl, the fallback to curl's partial
 * stdout on failure, the raw log/config reads, and the assembled dump. Never
 * fails (exit 0), matching the bash `set +e`.
 */

import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { diagnoseOutput } from './diagnose-output.js';
import { readRaw } from './read-raw.js';
import { runCargoRegistryDiagnose } from './run-diagnose.js';

vi.mock('node:child_process');
vi.mock('./read-raw.js');
vi.mock('./diagnose-output.js');

const exec = vi.mocked(execFileSync);
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
  readRawMock.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RUNNER_TEMP;
  delete process.env.HOME;
});

describe('runCargoRegistryDiagnose', () => {
  it('probes the endpoint, reads the log + config, and prints the assembled dump', () => {
    exec.mockReturnValue('GET /git/info/refs?service=git-upload-pack -> 200\n');
    readRawMock.mockImplementation((p) => (p === '/rt/cargo-http-registry.log' ? 'LOG' : 'CONFIG'));
    const code = runCargoRegistryDiagnose();

    expect(code).toBe(0);
    expect(exec).toHaveBeenCalledWith('curl', PROBE_ARGS, { encoding: 'utf8' });
    expect(readRawMock).toHaveBeenNthCalledWith(1, '/rt/cargo-http-registry.log');
    expect(readRawMock).toHaveBeenNthCalledWith(2, '/home/piot/.cargo/config.toml');
    expect(diagnose).toHaveBeenCalledWith({
      logRaw: 'LOG',
      probeRaw: 'GET /git/info/refs?service=git-upload-pack -> 200\n',
      configRaw: 'CONFIG',
    });
    expect(out.join('')).toBe('DUMP');
  });

  it('falls back to curl’s partial stdout when the probe throws', () => {
    exec.mockImplementation(() => {
      throw Object.assign(new Error('curl 7'), { stdout: '' });
    });
    runCargoRegistryDiagnose();
    expect(diagnose).toHaveBeenCalledWith(expect.objectContaining({ probeRaw: '' }));
  });

  it('uses empty string when the thrown error has no stdout', () => {
    exec.mockImplementation(() => {
      throw new Error('curl 7');
    });
    runCargoRegistryDiagnose();
    expect(diagnose).toHaveBeenCalledWith(expect.objectContaining({ probeRaw: '' }));
  });

  it('reads relative to an empty base when RUNNER_TEMP / HOME are unset', () => {
    delete process.env.RUNNER_TEMP;
    delete process.env.HOME;
    exec.mockReturnValue('');
    runCargoRegistryDiagnose();
    expect(readRawMock).toHaveBeenNthCalledWith(1, '/cargo-http-registry.log');
    expect(readRawMock).toHaveBeenNthCalledWith(2, '/.cargo/config.toml');
  });
});
