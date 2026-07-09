/**
 * `piot release-github` against the real CLI + real git — the e2e twin of
 * `test/integration/release-github.integration.test.ts`. Epic #442, #444.
 *
 * Where the integration test drives the engine in-process with the
 * subprocess boundary mocked, this one **shells out to the built CLI**
 * (`node dist/cli-bin.js release-github …`) against a **real git repo with
 * a real bare remote**. The git side — the whole #436/#437 fragility — runs
 * unmocked: a real `git tag --points-at HEAD`, a real ref-scoped
 * `git push origin refs/tags/<tag>` landing in a real bare remote. Only
 * `gh` is stubbed (a recording script on `PATH`), because cutting throwaway
 * GitHub Releases in a test loop is not hermetic; the stub still lets us
 * assert the `release view` → `release create` order and args.
 *
 * The scenario reproduces the #436 incident verbatim: the remote's floating
 * `v0` tag is force-moved to a commit that diverges from the local `v0`, so
 * a blanket `git fetch --tags` is *rejected* (self-checked below). A correct
 * `release-github` never fetches, so it publishes the new tag and its
 * Release regardless — that resilience is the contract this test pins.
 *
 * Red before the command exists: `release-github` is an unknown subcommand,
 * so the CLI exits 1, the remote never receives the tag, and gh is never
 * called.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first).
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');

let work: string;
let remote: string;
let bin: string;
let ghLog: string;
let ghState: string;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Shell out to the built CLI with the gh stub ahead on PATH. */
function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        GH_STUB_LOG: ghLog,
        GH_STUB_STATE: ghState,
        GH_TOKEN: 'stub-token',
      },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'piot-relgh-work-'));
  remote = mkdtempSync(join(tmpdir(), 'piot-relgh-remote-'));
  bin = mkdtempSync(join(tmpdir(), 'piot-relgh-bin-'));
  ghLog = join(bin, 'gh.log');
  ghState = join(bin, 'gh.state');

  // A recording `gh` stub: `release view <tag>` exits 0 iff the tag is in
  // the state file (Release exists); `release create <tag> …` records it
  // and exits 0. Every call is appended to the log for order/args asserts.
  const stub = [
    '#!/usr/bin/env bash',
    'echo "$@" >> "$GH_STUB_LOG"',
    'if [ "$1" = "release" ] && [ "$2" = "view" ]; then',
    '  grep -qxF "$3" "$GH_STUB_STATE" 2>/dev/null && exit 0 || exit 1',
    'fi',
    'if [ "$1" = "release" ] && [ "$2" = "create" ]; then',
    '  echo "$3" >> "$GH_STUB_STATE"',
    '  echo "https://github.com/acme/repo/releases/tag/$3"',
    '  exit 0',
    'fi',
    'exit 0',
    '',
  ].join('\n');
  writeFileSync(join(bin, 'gh'), stub);
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(ghState, '');

  // Real repo + bare remote. c1 → tag v0 → push v0 → c2 → force-move the
  // remote's v0 to c2 (diverges from the local v0 at c1) → cut the new
  // release tag at HEAD (what the engine would have done in the same job).
  git(['init', '-q', '-b', 'main'], work);
  git(['config', 'user.email', 'test@example.com'], work);
  git(['config', 'user.name', 'Test'], work);
  git(['config', 'commit.gpgsign', 'false'], work);
  git(['config', 'tag.gpgsign', 'false'], work);
  git(['commit', '-q', '--allow-empty', '-m', 'c1'], work);
  git(['tag', '-a', '-m', 'v0', 'v0'], work);
  git(['init', '--bare', '-q'], remote);
  git(['remote', 'add', 'origin', remote], work);
  git(['push', '-q', 'origin', 'refs/tags/v0'], work);
  git(['commit', '-q', '--allow-empty', '-m', 'c2'], work);
  git(['push', '-q', '--force', 'origin', 'HEAD:refs/tags/v0'], work);
  git(['tag', '-a', '-m', 'pkg-v1.0.0', 'pkg-v1.0.0'], work);
});

afterEach(() => {
  for (const d of [work, remote, bin]) rmSync(d, { recursive: true, force: true });
});

describe('piot release-github against a real git repo + bare remote (#444)', () => {
  it('reproduces #436: a blanket tag fetch is rejected by the diverged v0', () => {
    // Sanity that the scenario is armed — the failure a no-fetch command
    // must sidestep. A `git fetch --tags` here is non-zero.
    expect(() => git(['fetch', '--tags', 'origin'], work)).toThrow();
  });

  it('pushes the new tag ref-scoped and creates its Release despite the diverged v0', () => {
    const { code, stdout, stderr } = runCli(['release-github', '--cwd', work]);

    expect(code, `output:\n${stdout}\n${stderr}`).toBe(0);
    // The new tag reached the bare remote via the ref-scoped push.
    expect(git(['tag', '-l'], remote)).toContain('pkg-v1.0.0');
    // gh saw the idempotency view before the create.
    const log = readFileSync(ghLog, 'utf8');
    expect(log).toMatch(/release view pkg-v1\.0\.0[\s\S]*release create pkg-v1\.0\.0 --title pkg-v1\.0\.0 --generate-notes/);
    expect(stdout).toContain('Created GitHub Release for pkg-v1.0.0');
  });

  it('is idempotent: a second run skips the create', () => {
    const first = runCli(['release-github', '--cwd', work]);
    expect(first.code, `first run:\n${first.stdout}\n${first.stderr}`).toBe(0);

    const second = runCli(['release-github', '--cwd', work]);
    expect(second.code, `second run:\n${second.stdout}\n${second.stderr}`).toBe(0);
    expect(second.stdout).toContain('GitHub Release pkg-v1.0.0 already exists; skipping.');

    // Exactly one create across both runs.
    const creates = readFileSync(ghLog, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('release create pkg-v1.0.0'));
    expect(creates).toHaveLength(1);
  });
});
