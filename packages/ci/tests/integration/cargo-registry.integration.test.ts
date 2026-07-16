/**
 * Integration test for the cargo-http-registry harness (#454, epic #442).
 *
 * Drives the real `piot-ci cargo-registry <mode>` dispatch in-process — `run()`
 * → `runCargoRegistry` → `runCargoRegistryStart` / `runCargoRegistryDiagnose`
 * + `decideCargoRegistryStart` / `diagnoseOutput` — with only the OS boundary
 * (`node:child_process` for spawn, `node:fs/promises`, the exec seam) mocked.
 * Exercises the real decisions, so the success/failure branches and the
 * byte-exact diagnostic dump are asserted through the actual command.
 */

import { spawn } from 'node:child_process';
import { appendFile, open, readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';
import { execCapture } from '../../src/utils/exec-capture.js';
import { sleep } from '../../src/utils/sleep.js';

vi.mock('node:child_process');
vi.mock('node:fs/promises');
vi.mock('../../src/utils/exec-capture.js');
vi.mock('../../src/utils/sleep.js');

const exec = vi.mocked(execCapture);
const spawnMock = vi.mocked(spawn);
let out: string[];

beforeEach(() => {
  out = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.mocked(sleep).mockResolvedValue(undefined);
  process.env.RUNNER_TEMP = '/rt';
  process.env.GITHUB_ENV = '/gh-env';
  process.env.HOME = '/home/piot';
  // @ts-expect-error — minimal ChildProcess shape.
  spawnMock.mockReturnValue({ pid: 999, unref: vi.fn() });
  // @ts-expect-error — minimal FileHandle shape.
  vi.mocked(open).mockResolvedValue({ fd: 9, close: vi.fn() });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RUNNER_TEMP;
  delete process.env.GITHUB_ENV;
  delete process.env.HOME;
});

const cargo = (mode: string): Promise<number> => run(['node', 'piot-ci', 'cargo-registry', mode]);

describe('piot-ci cargo-registry (integration)', () => {
  it('start: on a ready probe, exports the PID and writes the git-fetch-with-cli config', async () => {
    exec.mockResolvedValue({ stdout: '', stderr: '' }); // every curl succeeds → probe ready on attempt 1
    await expect(cargo('start')).resolves.toBe(0);
    expect(appendFile).toHaveBeenCalledWith('/gh-env', 'CARGO_HTTP_REGISTRY_PID=999\n');
    expect(appendFile).toHaveBeenCalledWith('/home/piot/.cargo/config.toml', '\n[net]\ngit-fetch-with-cli = true\n');
    expect(out.join('')).toBe('cargo-http-registry up (attempt 1)\n');
  });

  it('start: after 15 failed probes, fails with the header + raw log dump and no config', async () => {
    exec.mockRejectedValue(new Error('curl: connection refused'));
    vi.mocked(readFile).mockResolvedValue('registry crashed\n');
    await expect(cargo('start')).resolves.toBe(1);
    expect(out.join('')).toBe('::error::cargo-http-registry never came up; dumping log:\nregistry crashed\n');
    expect(appendFile).not.toHaveBeenCalledWith('/home/piot/.cargo/config.toml', expect.anything());
  });

  it('diagnose: prints the grouped dump with raw log/config bytes and the probe code', async () => {
    exec.mockResolvedValue({ stdout: 'GET /git/info/refs?service=git-upload-pack -> 200\n', stderr: '' });
    vi.mocked(readFile).mockImplementation(((p: string) =>
      Promise.resolve(p === '/rt/cargo-http-registry.log' ? 'srv log\n' : '\n[net]\ngit-fetch-with-cli = true\n')) as unknown as typeof readFile,
    );
    await expect(cargo('diagnose')).resolves.toBe(0);
    expect(out.join('')).toBe(
      '::group::cargo-http-registry log\n' +
        'srv log\n' +
        '::endgroup::\n' +
        '::group::endpoint probe\n' +
        'GET /git/info/refs?service=git-upload-pack -> 200\n' +
        '::endgroup::\n' +
        '::group::~/.cargo/config.toml\n' +
        '\n[net]\ngit-fetch-with-cli = true\n' +
        '::endgroup::\n',
    );
  });
});
