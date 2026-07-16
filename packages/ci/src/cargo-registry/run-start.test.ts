/**
 * Composition-root wiring test for cargo-registry `start` (#454). Mocks the OS
 * boundary (`node:child_process` for spawn, `node:fs/promises`), the process
 * seam (`../utils/exec-capture.js`, `../utils/sleep.js`), `./decide-start.js`,
 * and `./read-raw.js`, isolating the plumbing: the env guard, the detached
 * spawn + log redirect + PID export, the bounded readiness poll (curl + sleep),
 * and the success (config write) / failure (raw log dump) branches decide selects.
 */

import { spawn } from 'node:child_process';
import { appendFile, mkdir, open } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';

vi.mock('../utils/exec-error.js', async () => await vi.importActual<typeof import('../utils/exec-error.js')>('../utils/exec-error.js'));
import { sleep } from '../utils/sleep.js';
import { decideCargoRegistryStart } from './decide-start.js';
import { readRaw } from './read-raw.js';
import { runCargoRegistryStart } from './run-start.js';

vi.mock('node:child_process');
vi.mock('node:fs/promises');
vi.mock('../utils/exec-capture.js');
vi.mock('../utils/sleep.js');
vi.mock('./decide-start.js');
vi.mock('./read-raw.js');

const exec = vi.mocked(execCapture);
const sleepMock = vi.mocked(sleep);
const spawnMock = vi.mocked(spawn);
const decide = vi.mocked(decideCargoRegistryStart);
const readRawMock = vi.mocked(readRaw);
const unref = vi.fn();
const closeHandle = vi.fn();
const out: string[] = [];

const ENDPOINT = 'http://127.0.0.1:35503/git/info/refs?service=git-upload-pack';

// `curlFailures` leading probe attempts reject before one resolves.
function stub(curlFailures = 0): void {
  let curls = 0;
  exec.mockImplementation(() => {
    curls += 1;
    if (curls <= curlFailures) {
      return Promise.reject(new ExecError('curl: connection refused', '', '', 22));
    }
    return Promise.resolve({ stdout: '', stderr: '' });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  process.env.RUNNER_TEMP = '/rt';
  process.env.GITHUB_ENV = '/gh-env';
  process.env.HOME = '/home/piot';
  // @ts-expect-error — minimal ChildProcess shape run-start consumes.
  spawnMock.mockReturnValue({ pid: 4242, unref });
  // @ts-expect-error — minimal FileHandle shape run-start consumes.
  vi.mocked(open).mockResolvedValue({ fd: 7, close: closeHandle });
  sleepMock.mockResolvedValue(undefined);
  decide.mockReturnValue({ exitCode: 0, errorLine: null, writeConfig: true });
  readRawMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RUNNER_TEMP;
  delete process.env.GITHUB_ENV;
  delete process.env.HOME;
});

describe('runCargoRegistryStart: env guard', () => {
  it.each(['RUNNER_TEMP', 'GITHUB_ENV', 'HOME'])('fails when %s is unset and never spawns', async (name) => {
    delete process.env[name];
    stub(0);
    await expect(runCargoRegistryStart()).resolves.toBe(1);
    expect(out.join('')).toBe('::error::cargo-registry: RUNNER_TEMP, GITHUB_ENV and HOME must be set.\n');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it.each(['RUNNER_TEMP', 'GITHUB_ENV', 'HOME'])('fails when %s is the empty string and never spawns', async (name) => {
    process.env[name] = '';
    stub(0);
    await expect(runCargoRegistryStart()).resolves.toBe(1);
    expect(out.join('')).toBe('::error::cargo-registry: RUNNER_TEMP, GITHUB_ENV and HOME must be set.\n');
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe('runCargoRegistryStart: backgrounding', () => {
  it('creates the registry root, spawns detached to the log fd, unrefs, and exports the PID', async () => {
    stub(0);
    await runCargoRegistryStart();
    expect(mkdir).toHaveBeenCalledWith('/rt/piot-alt-registry', { recursive: true });
    expect(open).toHaveBeenCalledWith('/rt/cargo-http-registry.log', 'w');
    expect(spawnMock).toHaveBeenCalledWith('cargo-http-registry', ['--addr', '127.0.0.1:35503', '/rt/piot-alt-registry'], {
      detached: true,
      stdio: ['ignore', 7, 7],
    });
    expect(unref).toHaveBeenCalledOnce();
    expect(closeHandle).toHaveBeenCalledOnce();
    expect(appendFile).toHaveBeenCalledWith('/gh-env', 'CARGO_HTTP_REGISTRY_PID=4242\n');
  });
});

describe('runCargoRegistryStart: readiness poll', () => {
  it('announces on the first successful probe and passes ready:true to decide', async () => {
    stub(0);
    await runCargoRegistryStart();
    expect(exec).toHaveBeenCalledWith('curl', ['-fsS', '-o', '/dev/null', ENDPOINT]);
    expect(out).toContain('cargo-http-registry up (attempt 1)\n');
    expect(decide).toHaveBeenCalledWith({ ready: true });
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it('retries with a 1s sleep and announces the winning attempt', async () => {
    stub(2);
    await runCargoRegistryStart();
    expect(out).toContain('cargo-http-registry up (attempt 3)\n');
    expect(sleepMock).toHaveBeenCalledWith(1000);
    expect(sleepMock).toHaveBeenCalledTimes(2);
    expect(decide).toHaveBeenCalledWith({ ready: true });
  });

  it('gives up after 15 failed probes and passes ready:false to decide', async () => {
    stub(15);
    decide.mockReturnValue({
      exitCode: 1,
      errorLine: '::error::cargo-http-registry never came up; dumping log:',
      writeConfig: false,
    });
    readRawMock.mockResolvedValue('boom log\n');
    const code = await runCargoRegistryStart();
    expect(decide).toHaveBeenCalledWith({ ready: false });
    expect(code).toBe(1);
    expect(out.join('')).toBe('::error::cargo-http-registry never came up; dumping log:\nboom log\n');
    expect(readRawMock).toHaveBeenCalledWith('/rt/cargo-http-registry.log');
    expect(sleepMock).toHaveBeenCalledTimes(15);
  });

  it('emits only the header (no trailing bytes) when the log file is absent', async () => {
    stub(15);
    decide.mockReturnValue({
      exitCode: 1,
      errorLine: '::error::cargo-http-registry never came up; dumping log:',
      writeConfig: false,
    });
    readRawMock.mockResolvedValue(null);
    await runCargoRegistryStart();
    expect(out.join('')).toBe('::error::cargo-http-registry never came up; dumping log:\n');
  });
});

describe('runCargoRegistryStart: config write branch', () => {
  it('appends the git-fetch-with-cli block to cargo config on success', async () => {
    stub(0);
    await runCargoRegistryStart();
    expect(mkdir).toHaveBeenCalledWith('/home/piot/.cargo', { recursive: true });
    expect(appendFile).toHaveBeenCalledWith('/home/piot/.cargo/config.toml', '\n[net]\ngit-fetch-with-cli = true\n');
  });

  it('does NOT write config on the failure branch', async () => {
    stub(15);
    decide.mockReturnValue({
      exitCode: 1,
      errorLine: '::error::cargo-http-registry never came up; dumping log:',
      writeConfig: false,
    });
    await runCargoRegistryStart();
    expect(appendFile).not.toHaveBeenCalledWith('/home/piot/.cargo/config.toml', expect.anything());
  });
});
