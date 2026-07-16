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

import { execFile, spawn } from 'node:child_process';
import type * as ChildProcess from 'node:child_process';
import { appendFile, open, readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

// Integration tests run first-party code (the exec seam + the real `sleep`)
// for real and mock only the Node built-ins underneath: `execFile` (what
// `execCapture` uses, for the curl probe) and `spawn` (for the backgrounded
// registry process). Mocking the seam or `sleep` would trip the
// testing-conventions `no-first-party-mock` gate — the retry loop's real
// `sleep` is driven by fake timers instead (see `withFakeTimers`).
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn(), spawn: vi.fn() };
});
vi.mock('node:fs/promises');

const execFileMock = vi.mocked(execFile);
const spawnMock = vi.mocked(spawn);
let out: string[];

/** Wire the curl probe (mocked at `execFile`): ready when `ok`, else rejects. */
function wireProbe(ok: boolean, stdout = ''): void {
  execFileMock.mockImplementation(((_cmd: string, _args: readonly string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    if (ok) {
      cb(null, stdout, '');
    } else {
      cb(new Error('curl: connection refused'), '', '');
    }
    return undefined as unknown as ChildProcess.ChildProcess;
  }) as unknown as typeof execFile);
}

/**
 * Drive a `run()` whose retry loop `await`s real `sleep(1000)`s without waiting
 * real seconds. A probe's sleep timer is only scheduled after the awaited
 * `execCapture` rejection settles as a microtask, so a single
 * `runAllTimersAsync` would see no timer yet; loop: fast-forward past the
 * interval and flush a microtask each turn until the run settles.
 */
async function withFakeTimers(fn: () => Promise<number>): Promise<number> {
  vi.useFakeTimers();
  try {
    const p = fn();
    let done = false;
    void p.then(
      () => { done = true; },
      () => { done = true; },
    );
    while (!done) {
      await vi.advanceTimersByTimeAsync(2000);
      await Promise.resolve();
    }
    return await p;
  } finally {
    vi.useRealTimers();
  }
}

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
    wireProbe(true); // every curl succeeds → probe ready on attempt 1
    await expect(cargo('start')).resolves.toBe(0);
    expect(appendFile).toHaveBeenCalledWith('/gh-env', 'CARGO_HTTP_REGISTRY_PID=999\n');
    expect(appendFile).toHaveBeenCalledWith('/home/piot/.cargo/config.toml', '\n[net]\ngit-fetch-with-cli = true\n');
    expect(out.join('')).toBe('cargo-http-registry up (attempt 1)\n');
  });

  it('start: after 15 failed probes, fails with the header + raw log dump and no config', async () => {
    wireProbe(false); // every curl rejects → 15 attempts, each sleeping (driven by fake timers)
    vi.mocked(readFile).mockResolvedValue('registry crashed\n');
    await expect(withFakeTimers(() => cargo('start'))).resolves.toBe(1);
    expect(out.join('')).toBe('::error::cargo-http-registry never came up; dumping log:\nregistry crashed\n');
    expect(appendFile).not.toHaveBeenCalledWith('/home/piot/.cargo/config.toml', expect.anything());
  });

  it('diagnose: prints the grouped dump with raw log/config bytes and the probe code', async () => {
    wireProbe(true, 'GET /git/info/refs?service=git-upload-pack -> 200\n');
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
