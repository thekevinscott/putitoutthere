/**
 * Composition-root wiring test for cargo-registry `start` (#454). Mocks the OS
 * boundary (`node:child_process`, `node:fs`), `./decide-start.js`, and
 * `./read-raw.js`, isolating the plumbing: the env guard, the detached spawn +
 * log redirect + PID export, the bounded readiness poll (curl + sleep), and the
 * success (config write) / failure (raw log dump) branches decide selects.
 */

import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decideCargoRegistryStart } from './decide-start.js';
import { readRaw } from './read-raw.js';
import { runCargoRegistryStart } from './run-start.js';

vi.mock('node:child_process');
vi.mock('node:fs');
vi.mock('./decide-start.js');
vi.mock('./read-raw.js');

const exec = vi.mocked(execFileSync);
const spawnMock = vi.mocked(spawn);
const decide = vi.mocked(decideCargoRegistryStart);
const readRawMock = vi.mocked(readRaw);
const unref = vi.fn();
const out: string[] = [];

const ENDPOINT = 'http://127.0.0.1:35503/git/info/refs?service=git-upload-pack';

// `curlFailures` leading probe attempts throw before one succeeds.
function stub(curlFailures = 0): void {
  let curls = 0;
  exec.mockImplementation((cmd) => {
    if (cmd === 'sleep') {
      return '';
    }
    curls += 1;
    if (curls <= curlFailures) {
      throw new Error('curl: connection refused');
    }
    return '';
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
  vi.mocked(openSync).mockReturnValue(7);
  decide.mockReturnValue({ exitCode: 0, errorLine: null, writeConfig: true });
  readRawMock.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RUNNER_TEMP;
  delete process.env.GITHUB_ENV;
  delete process.env.HOME;
});

describe('runCargoRegistryStart: env guard', () => {
  it.each(['RUNNER_TEMP', 'GITHUB_ENV', 'HOME'])('fails when %s is unset and never spawns', (name) => {
    delete process.env[name];
    stub(0);
    expect(runCargoRegistryStart()).toBe(1);
    expect(out.join('')).toBe('::error::cargo-registry: RUNNER_TEMP, GITHUB_ENV and HOME must be set.\n');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it.each(['RUNNER_TEMP', 'GITHUB_ENV', 'HOME'])('fails when %s is the empty string and never spawns', (name) => {
    process.env[name] = '';
    stub(0);
    expect(runCargoRegistryStart()).toBe(1);
    expect(out.join('')).toBe('::error::cargo-registry: RUNNER_TEMP, GITHUB_ENV and HOME must be set.\n');
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe('runCargoRegistryStart: backgrounding', () => {
  it('creates the registry root, spawns detached to the log fd, unrefs, and exports the PID', () => {
    stub(0);
    runCargoRegistryStart();
    expect(mkdirSync).toHaveBeenCalledWith('/rt/piot-alt-registry', { recursive: true });
    expect(openSync).toHaveBeenCalledWith('/rt/cargo-http-registry.log', 'w');
    expect(spawnMock).toHaveBeenCalledWith('cargo-http-registry', ['--addr', '127.0.0.1:35503', '/rt/piot-alt-registry'], {
      detached: true,
      stdio: ['ignore', 7, 7],
    });
    expect(unref).toHaveBeenCalledOnce();
    expect(closeSync).toHaveBeenCalledWith(7);
    expect(appendFileSync).toHaveBeenCalledWith('/gh-env', 'CARGO_HTTP_REGISTRY_PID=4242\n');
  });
});

describe('runCargoRegistryStart: readiness poll', () => {
  it('announces on the first successful probe and passes ready:true to decide', () => {
    stub(0);
    runCargoRegistryStart();
    expect(exec).toHaveBeenCalledWith('curl', ['-fsS', '-o', '/dev/null', ENDPOINT], { stdio: 'ignore' });
    expect(out).toContain('cargo-http-registry up (attempt 1)\n');
    expect(decide).toHaveBeenCalledWith({ ready: true });
    const sleeps = exec.mock.calls.filter((c) => c[0] === 'sleep').length;
    expect(sleeps).toBe(0);
  });

  it('retries with a 1s sleep and announces the winning attempt', () => {
    stub(2);
    runCargoRegistryStart();
    expect(out).toContain('cargo-http-registry up (attempt 3)\n');
    expect(exec).toHaveBeenCalledWith('sleep', ['1'], { stdio: 'ignore' });
    const sleeps = exec.mock.calls.filter((c) => c[0] === 'sleep').length;
    expect(sleeps).toBe(2);
    expect(decide).toHaveBeenCalledWith({ ready: true });
  });

  it('gives up after 15 failed probes and passes ready:false to decide', () => {
    stub(15);
    decide.mockReturnValue({
      exitCode: 1,
      errorLine: '::error::cargo-http-registry never came up; dumping log:',
      writeConfig: false,
    });
    readRawMock.mockReturnValue('boom log\n');
    const code = runCargoRegistryStart();
    expect(decide).toHaveBeenCalledWith({ ready: false });
    expect(code).toBe(1);
    expect(out.join('')).toBe('::error::cargo-http-registry never came up; dumping log:\nboom log\n');
    expect(readRawMock).toHaveBeenCalledWith('/rt/cargo-http-registry.log');
    const sleeps = exec.mock.calls.filter((c) => c[0] === 'sleep').length;
    expect(sleeps).toBe(15);
  });

  it('emits only the header (no trailing bytes) when the log file is absent', () => {
    stub(15);
    decide.mockReturnValue({
      exitCode: 1,
      errorLine: '::error::cargo-http-registry never came up; dumping log:',
      writeConfig: false,
    });
    readRawMock.mockReturnValue(null);
    runCargoRegistryStart();
    expect(out.join('')).toBe('::error::cargo-http-registry never came up; dumping log:\n');
  });
});

describe('runCargoRegistryStart: config write branch', () => {
  it('appends the git-fetch-with-cli block to cargo config on success', () => {
    stub(0);
    runCargoRegistryStart();
    expect(mkdirSync).toHaveBeenCalledWith('/home/piot/.cargo', { recursive: true });
    expect(appendFileSync).toHaveBeenCalledWith('/home/piot/.cargo/config.toml', '\n[net]\ngit-fetch-with-cli = true\n');
  });

  it('does NOT write config on the failure branch', () => {
    stub(15);
    decide.mockReturnValue({
      exitCode: 1,
      errorLine: '::error::cargo-http-registry never came up; dumping log:',
      writeConfig: false,
    });
    runCargoRegistryStart();
    expect(appendFileSync).not.toHaveBeenCalledWith('/home/piot/.cargo/config.toml', expect.anything());
  });
});
