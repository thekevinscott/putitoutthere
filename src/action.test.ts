import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './action.js';

describe('action', () => {
  let stderrChunks: string[] = [];
  let exitCode: number | undefined;

  beforeEach(() => {
    stderrChunks = [];
    exitCode = undefined;
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
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
  });

  it('fails when INPUT_COMMAND is missing', async () => {
    await expect(main()).rejects.toThrow(/exit:1/);
    expect(stderrChunks.join('')).toMatch(/missing.*command/i);
  });

  it('invokes plan when INPUT_COMMAND=plan (and surfaces its exit code)', async () => {
    process.env.INPUT_COMMAND = 'plan';
    // Plan will fail because no putitoutthere.toml at this cwd.
    await expect(main()).rejects.toThrow(/exit:\d+/);
    expect(exitCode).not.toBe(undefined);
  });

  it('ignores non-zero exit when fail_on_error is false', async () => {
    process.env.INPUT_COMMAND = 'plan';
    process.env.INPUT_FAIL_ON_ERROR = 'false';
    await expect(main()).rejects.toThrow(/exit:0/);
  });

  it('write-version: forwards working_directory as --path and version as --version (#276)', async () => {
    // The reusable workflow's `_matrix.yml` invokes the action with
    // command: write-version, working_directory: ${{ matrix.path }},
    // version: ${{ matrix.version }}. Confirm the dispatch arm
    // forwards both inputs and exits non-zero on a missing pyproject
    // (the realistic failure shape for the action wrapper).
    process.env.INPUT_COMMAND = 'write-version';
    process.env.INPUT_WORKING_DIRECTORY = '/path/that/does/not/exist';
    process.env.INPUT_VERSION = '0.2.8';
    await expect(main()).rejects.toThrow(/exit:1/);
    expect(stderrChunks.join('')).toMatch(/pyproject\.toml/);
  });

});
