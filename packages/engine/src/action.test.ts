import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './action.js';

// `plan` now always probes the registry via `isPublished` (#412). For npm
// that is a `npm view` subprocess; stub it so the unit suite stays offline
// (→ "not published" → PUBLISH verdict), while git runs for real.
const realCp = vi.hoisted(() => ({
  execFileSync: undefined as unknown as typeof ChildProcess.execFileSync,
}));
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  realCp.execFileSync = actual.execFileSync;
  const patched = ((cmd: string, ...rest: unknown[]): unknown => {
    if (cmd === 'npm') {throw new Error('npm stubbed offline (unit)');}
    return (realCp.execFileSync as (...a: unknown[]) => unknown)(cmd, ...rest);
  }) as typeof actual.execFileSync;
  return { ...actual, execFileSync: patched };
});

describe('action', () => {
  let stderrChunks: string[] = [];
  let stdoutChunks: string[] = [];
  let exitCode: number | undefined;

  beforeEach(() => {
    stderrChunks = [];
    stdoutChunks = [];
    exitCode = undefined;
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

  it('write-launcher: forwards working_directory as --path (#299)', async () => {
    // The matrix's main row invokes the action with
    // command: write-launcher, working_directory: ${{ matrix.path }}.
    // Confirm the dispatch arm forwards the input and exits non-zero
    // when the directory does not host a putitoutthere.toml — the
    // realistic failure shape for the action wrapper.
    process.env.INPUT_COMMAND = 'write-launcher';
    process.env.INPUT_WORKING_DIRECTORY = '/path/that/does/not/exist';
    await expect(main()).rejects.toThrow(/exit:1/);
    expect(stderrChunks.join('')).toMatch(/putitoutthere\.toml/);
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

  it('plan: forwards release_packages as --release-packages', async () => {
    // The reusable workflow's `_matrix.yml` invokes the action with
    // command: plan, release_packages: ${{ inputs.release_packages }}.
    // Build a repo with a tagged package and NO new commits — the
    // change-detected path would plan nothing; the manual spec must
    // make `demo` show up in the emitted matrix.
    const repo = mkdtempSync(join(tmpdir(), 'action-relpkg-'));
    try {
      const git = (args: string[]): void => {
        execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
      };
      git(['init', '-q', '-b', 'main']);
      git(['config', 'user.email', 'test@example.com']);
      git(['config', 'user.name', 'Test']);
      git(['config', 'commit.gpgsign', 'false']);
      git(['config', 'tag.gpgsign', 'false']);
      mkdirSync(join(repo, 'packages/ts'), { recursive: true });
      writeFileSync(
        join(repo, 'putitoutthere.toml'),
        `[putitoutthere]
version = 1
[[package]]
name  = "demo"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
`,
        'utf8',
      );
      writeFileSync(join(repo, 'packages/ts/index.ts'), 'x', 'utf8');
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'init']);
      git(['tag', 'demo-v1.0.0']);

      process.env.INPUT_COMMAND = 'plan';
      process.env.INPUT_WORKING_DIRECTORY = repo;
      process.env.INPUT_RELEASE_PACKAGES = 'demo@minor';

      // main() exits 0 on a successful plan (process.exit is mocked to
      // throw `exit:<code>`).
      await expect(main()).rejects.toThrow(/exit:0/);
      // #412: plan --json is now { matrix, verdicts, skew }; the action's
      // `outputs.matrix` (written to $GITHUB_OUTPUT) stays the bare array.
      const out = JSON.parse(stdoutChunks.join('').trim()) as {
        matrix: Array<{ name: string; version: string }>;
      };
      expect(out.matrix.map((r) => r.name)).toEqual(['demo']);
      expect(out.matrix[0]!.version).toBe('1.1.0');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

});
