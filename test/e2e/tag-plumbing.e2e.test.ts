/**
 * Tag-plumbing engine commands against the real CLI + real git — the e2e
 * twin of `test/integration/tag-plumbing.integration.test.ts`. Epic #442,
 * sub-issue #446.
 *
 * Where the integration test drives the engine in-process, this one
 * **shells out to the built CLI** (`node dist/cli-bin.js …`) against a
 * **real git repo with a real bare remote**. The whole tag-move surface —
 * `git fetch --tags --force`, `git tag -f`, ref-scoped
 * `git push --force origin refs/tags/<tag>` — runs unmocked and lands in a
 * real bare remote.
 *
 * Consolidates the repo's two hand-rolled tag-move implementations
 * (`release-npm.yml`'s "Move floating major tag", `advance-v0.yml`'s
 * "Force-move v0") plus the two identical action-bundle folds into one
 * tested path. Red before the commands exist: they are unknown
 * subcommands, so the CLI exits 1 and no tag moves.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');

let work: string;
let remote: string;

function git(args: string[], cwd = work): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
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

function writeConfig(): void {
  writeFileSync(
    join(work, 'putitoutthere.toml'),
    [
      '[putitoutthere]',
      'version = 1',
      '',
      '[[package]]',
      'name = "putitoutthere"',
      'kind = "npm"',
      'path = "."',
      'globs = ["src/**/*.ts"]',
      'access = "public"',
      '',
    ].join('\n'),
    'utf8',
  );
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'piot-tagplumb-e2e-work-'));
  remote = mkdtempSync(join(tmpdir(), 'piot-tagplumb-e2e-remote-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
  git(['init', '--bare', '-q'], remote);
  git(['remote', 'add', 'origin', remote]);
});

afterEach(() => {
  for (const d of [work, remote]) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('piot advance-v0 against a real git repo + bare remote (#446)', () => {
  it('force-moves v0 to HEAD on the local repo and the remote', () => {
    git(['commit', '-q', '--allow-empty', '-m', 'c1']);
    git(['tag', 'v0', 'HEAD']);
    git(['push', '-q', 'origin', 'refs/tags/v0']);
    git(['commit', '-q', '--allow-empty', '-m', 'c2']);
    const head = git(['rev-parse', 'HEAD']);

    const { code, stdout, stderr } = runCli(['advance-v0', '--cwd', work]);

    expect(code, `${stdout}\n${stderr}`).toBe(0);
    expect(git(['rev-parse', 'v0'])).toBe(head);
    expect(git(['rev-parse', 'v0'], remote)).toBe(head);
    expect(stdout).toContain(`Moving v0 -> ${head}`);
  });
});

describe('piot advance-floating-major against a real git repo + bare remote (#446)', () => {
  it('force-moves v<major> to the newest release commit despite a diverged remote tag', () => {
    writeConfig();
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'c1']);
    git(['tag', 'putitoutthere-v0.1.0', 'HEAD']);
    git(['push', '-q', 'origin', 'refs/tags/putitoutthere-v0.1.0']);
    // A stale floating v0 on the remote at c1; the command must force past it.
    git(['tag', 'v0', 'HEAD']);
    git(['push', '-q', 'origin', 'refs/tags/v0']);
    git(['commit', '-q', '--allow-empty', '-m', 'c2']);
    git(['tag', 'putitoutthere-v0.2.0', 'HEAD']);
    git(['push', '-q', 'origin', 'refs/tags/putitoutthere-v0.2.0']);
    // Diverge the local v0 from the remote so a non-forced push would reject.
    git(['tag', '-f', 'v0', 'HEAD']);
    const target = git(['rev-parse', 'putitoutthere-v0.2.0^{commit}']);

    const { code, stdout, stderr } = runCli(['advance-floating-major', '--cwd', work]);

    expect(code, `${stdout}\n${stderr}`).toBe(0);
    expect(git(['rev-parse', 'v0^{commit}'], remote)).toBe(target);
    expect(stdout).toContain('Moving floating tag v0 ->');
  });

  it('no-ops when there is no release tag yet', () => {
    writeConfig();
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'c1']);

    const { code, stdout, stderr } = runCli(['advance-floating-major', '--cwd', work]);

    expect(code, `${stdout}\n${stderr}`).toBe(0);
    expect(stdout).toContain('No putitoutthere-v* tags yet; nothing to track.');
  });
});

describe('piot fold-bundle against a real git repo (#446)', () => {
  it('creates a bundle commit forwarding the parent body under the subject', () => {
    writeFileSync(join(work, 'README.md'), 'hi\n', 'utf8');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'feat: bump\n\nrelease: minor']);
    const parent = git(['rev-parse', 'HEAD']);

    mkdirSync(join(work, 'dist-action'), { recursive: true });
    writeFileSync(join(work, 'dist-action/index.js'), '// bundle\n', 'utf8');
    git(['add', '-f', 'dist-action/']);

    const { code, stdout, stderr } = runCli([
      'fold-bundle', '--cwd', work, '--subject', 'chore(release): bundle action',
    ]);

    expect(code, `${stdout}\n${stderr}`).toBe(0);
    expect(git(['rev-parse', 'HEAD^'])).toBe(parent);
    const body = git(['log', '-1', '--format=%B', 'HEAD']);
    expect(body).toMatch(/chore\(release\): bundle action/);
    expect(body).toMatch(/release:\s*minor/i);
  });

  it('exits non-zero with the guard message when nothing is staged', () => {
    mkdirSync(join(work, 'dist-action'), { recursive: true });
    writeFileSync(join(work, 'dist-action/index.js'), '// bundle\n', 'utf8');
    git(['add', '-f', 'dist-action/']);
    git(['commit', '-q', '-m', 'seed with bundle already committed']);

    const { code, stderr } = runCli(['fold-bundle', '--cwd', work, '--subject', 'chore(v0): bundle action']);

    expect(code).toBe(1);
    expect(stderr).toContain('No bundle changes to commit');
  });
});
