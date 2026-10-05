/**
 * `action` unit tests. `main()` is the GHA adapter: reads the `INPUT_*` env,
 * shapes the CLI argv, dispatches, and surfaces the exit code (honouring
 * `fail_on_error`).
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
    // The callback must fire: `flushStdio` awaits it before every exit, so a
    // mock that only returns `true` would park `main()` forever.
    vi.spyOn(process.stderr, 'write').mockImplementation(((
      chunk: unknown,
      cb?: () => void,
    ) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
      cb?.();
      return true;
    }) as unknown as typeof process.stderr.write);
    vi.spyOn(process.stdout, 'write').mockImplementation(((
      chunk: unknown,
      cb?: () => void,
    ) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
      cb?.();
      return true;
    }) as unknown as typeof process.stdout.write);
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
    delete process.env.INPUT_STAGE_TO;
    delete process.env.INPUT_BIN;
    delete process.env.INPUT_TARGET;
    delete process.env.INPUT_EXPECT;
    delete process.env.INPUT_BUILD;
    delete process.env.INPUT_MATRIX;
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

  it('reconcile: forwards expect as --expect (#694)', async () => {
    // `pypi-tag.yml` invokes the action with command: reconcile and
    // expect: ${{ inputs.expect }} — the release job's
    // `delegated_packages`, forwarded unreshaped. Without this hop the
    // adapter drops the expectation, reconcile falls back to reading
    // PyPI's project pointer, and a first publish that has not
    // propagated reads as "never published": `actions: []`, exit 0, tag
    // silently lost.
    process.env.INPUT_COMMAND = 'reconcile';
    process.env.INPUT_WORKING_DIRECTORY = '/repo';
    process.env.INPUT_EXPECT = '[{"name":"demo-py","version":"0.0.0","tag":"demo-py-v0.0.0"}]';
    await expect(main()).rejects.toThrow(/exit:0/);
    expect(runMock).toHaveBeenCalledWith([
      'node',
      'putitoutthere',
      'reconcile',
      '--json',
      '--cwd',
      '/repo',
      '--expect',
      '[{"name":"demo-py","version":"0.0.0","tag":"demo-py-v0.0.0"}]',
    ]);
  });

  it('reconcile: omits --expect when the input is unset (#694)', async () => {
    // Bare `piot reconcile` must stay reachable: a consumer on an older
    // template, or a manual re-run, passes no expectation and gets the
    // discovery pass. An empty `--expect ''` would instead be parsed as
    // an expectation of nothing.
    process.env.INPUT_COMMAND = 'reconcile';
    process.env.INPUT_WORKING_DIRECTORY = '/repo';
    await expect(main()).rejects.toThrow(/exit:0/);
    expect(runMock).toHaveBeenCalledWith([
      'node',
      'putitoutthere',
      'reconcile',
      '--json',
      '--cwd',
      '/repo',
    ]);
  });

  it('npm-build: forwards the row inputs, or the matrix alone', async () => {
    Object.assign(process.env, { INPUT_COMMAND: 'npm-build', INPUT_WORKING_DIRECTORY: 'p', INPUT_TARGET: 't', INPUT_BUILD: 'b', INPUT_VERSION: '1' });
    await expect(main()).rejects.toThrow(/exit:0/);
    expect(runMock).toHaveBeenLastCalledWith(['node', 'putitoutthere', 'npm-build', '--path', 'p', '--target', 't', '--build', 'b', '--version', '1']);
    Object.assign(process.env, { INPUT_WORKING_DIRECTORY: '', INPUT_TARGET: '', INPUT_BUILD: '', INPUT_VERSION: '', INPUT_MATRIX: '[]' });
    await expect(main()).rejects.toThrow(/exit:0/);
    expect(runMock).toHaveBeenLastCalledWith(['node', 'putitoutthere', 'npm-build', '--matrix', '[]']);
  });

  it('verify-bundle-cli: splits the command and forwards the four flags (#595)', async () => {
    // `_matrix.yml`'s bundle_cli guard invokes the action with
    // command: verify-bundle-cli, working_directory: ${{ matrix.path }},
    // stage_to / bin: ${{ matrix.bundle_cli.* }}, target: ${{ matrix.target }}.
    // `verify` is a command with subcommands but Actions inputs are flat, so
    // the adapter owns the split into two argv tokens. No `--json` and no
    // `--cwd`: the subcommand emits a single human line and resolves its
    // relative `--path` against the runner working dir (the repo root).
    process.env.INPUT_COMMAND = 'verify-bundle-cli';
    process.env.INPUT_WORKING_DIRECTORY = 'packages/python';
    process.env.INPUT_STAGE_TO = 'python/dirsql/_binary';
    process.env.INPUT_BIN = 'dirsql';
    process.env.INPUT_TARGET = 'x86_64-pc-windows-msvc';
    await expect(main()).rejects.toThrow(/exit:0/);
    expect(runMock).toHaveBeenCalledWith([
      'node',
      'putitoutthere',
      'verify',
      'bundle-cli',
      '--path',
      'packages/python',
      '--stage-to',
      'python/dirsql/_binary',
      '--bin',
      'dirsql',
      '--target',
      'x86_64-pc-windows-msvc',
    ]);
  });

  it('verify-bundle-cli: omits flags whose inputs are unset (#595)', async () => {
    // Every one of the four inputs defaults to `''` in action.yml, so an
    // omitted input must produce *no flag at all* — never a flag carrying
    // an empty value, which would make `--stage-to` swallow the next token
    // and verify a path nobody asked for. With all four unset the argv is
    // the bare subcommand, and the CLI answers with its own
    // `verify bundle-cli requires --stage-to <dir>` error.
    process.env.INPUT_COMMAND = 'verify-bundle-cli';
    await expect(main()).rejects.toThrow(/exit:0/);
    expect(runMock).toHaveBeenCalledWith([
      'node',
      'putitoutthere',
      'verify',
      'bundle-cli',
    ]);
  });

  it('drains stdio before every exit, so a large failure dump survives (#664)', async () => {
    // Writes to the runner's pipe are async and `process.exit` drops whatever
    // is still queued; an 8 MiB publish dump arrived truncated at ~146KB,
    // losing the tail where the tool prints its error.
    const order: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((
      _chunk: unknown,
      cb?: () => void,
    ) => {
      order.push('drain:stdout');
      cb?.();
      return true;
    }) as unknown as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(((
      _chunk: unknown,
      cb?: () => void,
    ) => {
      order.push('drain:stderr');
      cb?.();
      return true;
    }) as unknown as typeof process.stderr.write);

    process.env.INPUT_COMMAND = 'plan';
    runMock.mockResolvedValue(2);
    await expect(main()).rejects.toThrow(/exit:2/);

    expect(order).toEqual(['drain:stdout', 'drain:stderr']);
  });

  it('drains stdio before the missing-command exit, so the reason is not lost (#664)', async () => {
    await expect(main()).rejects.toThrow(/exit:1/);

    // The message, then the two zero-length drain probes.
    expect(stderrChunks).toHaveLength(2);
    expect(stderrChunks[0]).toMatch(/missing.*command/i);
    expect(stderrChunks[1]).toBe('');
    expect(stdoutChunks).toEqual(['']);
  });

  it('verify-bundle-cli: surfaces a failed verification as a non-zero exit (#595)', async () => {
    // The guard's whole purpose: a wheel missing its staged binary must
    // fail the build step, not warn. The adapter must not swallow the
    // subcommand's exit code.
    process.env.INPUT_COMMAND = 'verify-bundle-cli';
    process.env.INPUT_WORKING_DIRECTORY = 'packages/python';
    process.env.INPUT_STAGE_TO = 'stage/bin';
    process.env.INPUT_BIN = 'mytool';
    process.env.INPUT_TARGET = 'x86_64-unknown-linux-gnu';
    runMock.mockResolvedValue(1);
    await expect(main()).rejects.toThrow(/exit:1/);
  });
});
