/**
 * Integration test for the cargo-http-registry harness (#454, epic #442).
 *
 * Drives the real `piot-ci cargo-registry <mode>` dispatch in-process — `run()`
 * → `runCargoRegistry` → `runCargoRegistryStart` / `runCargoRegistryDiagnose`
 * + `decideCargoRegistryStart` / `diagnoseOutput` — with only the OS boundary
 * (`node:child_process`, `node:fs`) mocked. Exercises the real decisions, so
 * the success/failure branches and the byte-exact diagnostic dump are asserted
 * through the actual command.
 */

import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, openSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

vi.mock('node:child_process');
vi.mock('node:fs');

const exec = vi.mocked(execFileSync);
const spawnMock = vi.mocked(spawn);
let out: string[];

beforeEach(() => {
  out = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  process.env.RUNNER_TEMP = '/rt';
  process.env.GITHUB_ENV = '/gh-env';
  process.env.HOME = '/home/piot';
  // @ts-expect-error — minimal ChildProcess shape.
  spawnMock.mockReturnValue({ pid: 999, unref: vi.fn() });
  vi.mocked(openSync).mockReturnValue(9);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RUNNER_TEMP;
  delete process.env.GITHUB_ENV;
  delete process.env.HOME;
});

const cargo = (mode: string): number => run(['node', 'piot-ci', 'cargo-registry', mode]);

describe('piot-ci cargo-registry (integration)', () => {
  it('start: on a ready probe, exports the PID and writes the git-fetch-with-cli config', () => {
    exec.mockReturnValue(''); // every curl/sleep succeeds → probe ready on attempt 1
    expect(cargo('start')).toBe(0);
    expect(appendFileSync).toHaveBeenCalledWith('/gh-env', 'CARGO_HTTP_REGISTRY_PID=999\n');
    expect(appendFileSync).toHaveBeenCalledWith('/home/piot/.cargo/config.toml', '\n[net]\ngit-fetch-with-cli = true\n');
    expect(out.join('')).toBe('cargo-http-registry up (attempt 1)\n');
  });

  it('start: after 15 failed probes, fails with the header + raw log dump and no config', () => {
    exec.mockImplementation((cmd) => {
      if (cmd === 'sleep') {
        return '';
      }
      throw new Error('curl: connection refused');
    });
    vi.mocked(readFileSync).mockReturnValue('registry crashed\n');
    expect(cargo('start')).toBe(1);
    expect(out.join('')).toBe('::error::cargo-http-registry never came up; dumping log:\nregistry crashed\n');
    expect(appendFileSync).not.toHaveBeenCalledWith('/home/piot/.cargo/config.toml', expect.anything());
  });

  it('diagnose: prints the grouped dump with raw log/config bytes and the probe code', () => {
    exec.mockReturnValue('GET /git/info/refs?service=git-upload-pack -> 200\n');
    vi.mocked(readFileSync).mockImplementation((p) =>
      p === '/rt/cargo-http-registry.log' ? 'srv log\n' : '\n[net]\ngit-fetch-with-cli = true\n',
    );
    expect(cargo('diagnose')).toBe(0);
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
