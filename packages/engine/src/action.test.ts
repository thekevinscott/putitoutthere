/**
 * `action` unit tests. `main()` is the ~50-line GHA adapter: it reads the
 * `INPUT_*` env, shapes the CLI argv, dispatches, and surfaces the exit code
 * (honouring `fail_on_error`). The dispatcher itself (`./cli.js`'s `run`) is
 * mocked so this isolates the adapter's env-parsing / argv-shaping / exit-code
 * logic; the real plan / write-* behaviour is covered at the integration + e2e
 * tiers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Automock (no factory): the dispatcher double is generated from the real
// module so it can't drift from the source, satisfying unit isolation without a
// hand-written (untyped) factory.
vi.mock('./cli.js');

import { main } from './action.js';
import { run } from './cli.js';

const runMock = vi.mocked(run);

describe('action', () => {
  let stderrChunks: string[] = [];
  let stdoutChunks: string[] = [];
  let exitCode: number | undefined;

  beforeEach(() => {
    stderrChunks = [];
    stdoutChunks = [];
    exitCode = undefined;
    runMock.mockReset();
    runMock.mockResolvedValue(0);
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`exit:${exitCode}`);
    }) as typeof process.exit);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.INPUT_COMMAND;
    delete process.env.INPUT_FAIL_ON_ERROR;
    delete process.env.INPUT_WORKING_DIRECTORY;
    delete process.env.INPUT_VERSION;
    delete process.env.INPUT_RELEASE_PACKAGES;
  });

  it('fails when INPUT_COMMAND is missing', async () => {
    await expect(main()).rejects.toThrow(/exit:1/);
    expect(stderrChunks.join('')).toMatch(/missing.*command/i);
    // The adapter exits before ever reaching the dispatcher.
    expect(runMock).not.toHaveBeenCalled();
  });

  it('invokes plan when INPUT_COMMAND=plan (and surfaces its exit code)', async () => {
    process.env.INPUT_COMMAND = 'plan';
    runMock.mockResolvedValue(7);
    await expect(main()).rejects.toThrow(/exit:7/);
    expect(runMock).toHaveBeenCalledWith(['node', 'putitoutthere', 'plan', '--json']);
    expect(exitCode).toBe(7);
  });

  it('ignores non-zero exit when fail_on_error is false', async () => {
    process.env.INPUT_COMMAND = 'plan';
    process.env.INPUT_FAIL_ON_ERROR = 'false';
    runMock.mockResolvedValue(3);
    await expect(main()).rejects.toThrow(/exit:0/);
  });

  it('write-launcher: forwards working_directory as --path (#299)', async () => {
    // The matrix's main row invokes the action with
    // command: write-launcher, working_directory: ${{ matrix.path }}.
    // Confirm the dispatch arm forwards the input as `--path` (and adds no
    // `--json`, since write-launcher emits a single human line).
    process.env.INPUT_COMMAND = 'write-launcher';
    process.env.INPUT_WORKING_DIRECTORY = '/path/that/does/not/exist';
    await expect(main()).rejects.toThrow(/exit:0/);
    expect(runMock).toHaveBeenCalledWith([
      'node',
      'putitoutthere',
      'write-launcher',
      '--path',
      '/path/that/does/not/exist',
    ]);
  });

  it('write-version: forwards working_directory as --path and version as --version (#276)', async () => {
    // The reusable workflow's `_matrix.yml` invokes the action with
    // command: write-version, working_directory: ${{ matrix.path }},
    // version: ${{ matrix.version }}. Confirm the dispatch arm forwards both
    // inputs in the `--path` / `--version` argv shape.
    process.env.INPUT_COMMAND = 'write-version';
    process.env.INPUT_WORKING_DIRECTORY = '/path/that/does/not/exist';
    process.env.INPUT_VERSION = '0.2.8';
    await expect(main()).rejects.toThrow(/exit:0/);
    expect(runMock).toHaveBeenCalledWith([
      'node',
      'putitoutthere',
      'write-version',
      '--path',
      '/path/that/does/not/exist',
      '--version',
      '0.2.8',
    ]);
  });

  it('write-version: omits --path / --version when neither input is set', async () => {
    // With no working_directory or version, both guarded pushes are skipped
    // (the empty-input else branches), leaving a bare argv.
    process.env.INPUT_COMMAND = 'write-version';
    await expect(main()).rejects.toThrow(/exit:0/);
    expect(runMock).toHaveBeenCalledWith(['node', 'putitoutthere', 'write-version']);
  });

  it('write-launcher: omits --path when working_directory is unset', async () => {
    process.env.INPUT_COMMAND = 'write-launcher';
    await expect(main()).rejects.toThrow(/exit:0/);
    expect(runMock).toHaveBeenCalledWith(['node', 'putitoutthere', 'write-launcher']);
  });

  it('plan: forwards release_packages as --release-packages', async () => {
    // The reusable workflow's `_matrix.yml` invokes the action with
    // command: plan, working_directory, release_packages:
    // ${{ inputs.release_packages }}. Confirm the dispatch arm forwards the
    // manual spec (and `--cwd`) into the plan argv.
    process.env.INPUT_COMMAND = 'plan';
    process.env.INPUT_WORKING_DIRECTORY = '/repo';
    process.env.INPUT_RELEASE_PACKAGES = 'demo@minor';
    await expect(main()).rejects.toThrow(/exit:0/);
    expect(runMock).toHaveBeenCalledWith([
      'node',
      'putitoutthere',
      'plan',
      '--json',
      '--cwd',
      '/repo',
      '--release-packages',
      'demo@minor',
    ]);
  });
});
