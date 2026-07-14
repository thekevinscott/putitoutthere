/**
 * Tag-plumbing engine commands — `advance-v0`, `advance-floating-major`,
 * and `fold-bundle` (integration). Epic #442, sub-issue #446.
 *
 * Consolidation of the repo's two hand-rolled tag-move implementations
 * (`release-npm.yml`'s "Move floating major tag", `advance-v0.yml`'s
 * "Force-move v0") and the two identical action-bundle folds
 * (`release-npm.yml` + `advance-v0.yml`) into one tested engine path. Same
 * inputs, same outputs, same error messages — now colocated-tested rather
 * than inline bash.
 *
 * This tier drives the CLI in-process (`run([...])`) against a **real git
 * repo with a real bare remote**. There is no registry or network surface
 * to mock here — the only external surface these commands touch is `git`,
 * and a real `git` over throwaway temp dirs is fully deterministic, so it
 * runs unmocked (mirroring `src/git.test.ts`). The e2e twin
 * (`tests/e2e/tag-plumbing.e2e.test.ts`) shells out to the built CLI against
 * the same real-git shape.
 *
 * Red before the commands exist: each is an unknown subcommand, so `run`
 * prints "unknown command" and returns 1 — no tag moves, no fold commit.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

let work: string;
let remote: string;
const out: string[] = [];

function git(args: string[], cwd = work): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd();
}

function initRepo(): void {
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
}

/** A minimal, valid single-package config for the piot dogfood repo. */
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
  work = mkdtempSync(join(tmpdir(), 'piot-tagplumb-work-'));
  remote = mkdtempSync(join(tmpdir(), 'piot-tagplumb-remote-'));
  initRepo();
  git(['init', '--bare', '-q'], remote);
  git(['remote', 'add', 'origin', remote]);
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of [work, remote]) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('piot advance-v0: force-move v0 to HEAD (#446)', () => {
  it('moves v0 (local + remote) to HEAD and logs the move', async () => {
    git(['commit', '-q', '--allow-empty', '-m', 'c1']);
    git(['tag', 'v0', 'HEAD']); // stale v0 at c1
    git(['push', '-q', 'origin', 'refs/tags/v0']);
    git(['commit', '-q', '--allow-empty', '-m', 'c2']);
    const head = git(['rev-parse', 'HEAD']);

    const code = await run(['node', 'piot', 'advance-v0', '--cwd', work]);

    expect(code, out.join('')).toBe(0);
    expect(git(['rev-parse', 'v0'])).toBe(head);
    // The bare remote received the force-moved tag ref-scoped.
    expect(git(['rev-parse', 'v0'], remote)).toBe(head);
    expect(out.join('')).toContain(`Moving v0 -> ${head}`);
  });
});

describe('piot advance-floating-major: track the latest release (#446)', () => {
  beforeEach(() => {
    writeConfig();
  });

  it('moves v<major> to the newest putitoutthere-v* release commit', async () => {
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'c1']);
    git(['tag', 'putitoutthere-v0.1.0', 'HEAD']);
    git(['push', '-q', 'origin', 'refs/tags/putitoutthere-v0.1.0']);
    git(['commit', '-q', '--allow-empty', '-m', 'c2']);
    git(['tag', 'putitoutthere-v0.2.0', 'HEAD']);
    git(['push', '-q', 'origin', 'refs/tags/putitoutthere-v0.2.0']);
    const target = git(['rev-parse', 'putitoutthere-v0.2.0^{commit}']);

    const code = await run(['node', 'piot', 'advance-floating-major', '--cwd', work]);

    expect(code, out.join('')).toBe(0);
    expect(git(['rev-parse', 'v0^{commit}'])).toBe(target);
    expect(git(['rev-parse', 'v0^{commit}'], remote)).toBe(target);
    expect(out.join('')).toContain(
      `Moving floating tag v0 -> ${target} (latest release putitoutthere-v0.2.0)`,
    );
  });

  it('is idempotent: a second run reports no update and does not error', async () => {
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'c1']);
    git(['tag', 'putitoutthere-v1.0.0', 'HEAD']);
    git(['push', '-q', 'origin', 'refs/tags/putitoutthere-v1.0.0']);

    const first = await run(['node', 'piot', 'advance-floating-major', '--cwd', work]);
    expect(first, out.join('')).toBe(0);
    out.length = 0;

    const second = await run(['node', 'piot', 'advance-floating-major', '--cwd', work]);
    expect(second, out.join('')).toBe(0);
    expect(out.join('')).toContain('Floating tag v1 already at putitoutthere-v1.0.0; no update.');
  });

  it('no-ops with a message when there is no release tag yet', async () => {
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'c1']);

    const code = await run(['node', 'piot', 'advance-floating-major', '--cwd', work]);

    expect(code, out.join('')).toBe(0);
    expect(out.join('')).toContain('No putitoutthere-v* tags yet; nothing to track.');
  });
});

describe('piot fold-bundle: synthesize the bundle commit (#446)', () => {
  it('commits the staged bundle, forwarding the parent body under the subject', async () => {
    writeFileSync(join(work, 'README.md'), 'hi\n', 'utf8');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'feat: bump\n\nrelease: minor']);
    const parent = git(['rev-parse', 'HEAD']);

    mkdirSync(join(work, 'dist-action'), { recursive: true });
    writeFileSync(join(work, 'dist-action/index.js'), '// bundle\n', 'utf8');
    git(['add', '-f', 'dist-action/']);

    const code = await run([
      'node', 'piot', 'fold-bundle', '--cwd', work, '--subject', 'chore(release): bundle action',
    ]);

    expect(code, out.join('')).toBe(0);
    const head = git(['rev-parse', 'HEAD']);
    expect(head).not.toBe(parent);
    expect(git(['rev-parse', 'HEAD^'])).toBe(parent);
    expect(git(['ls-files', '--stage', 'dist-action/index.js'])).toMatch(/dist-action\/index\.js/);
    const body = git(['log', '-1', '--format=%B', 'HEAD']);
    expect(body).toMatch(/chore\(release\): bundle action/);
    // The release trailer on the parent survives into the new HEAD so the
    // publish-time plan re-derivation doesn't silently downgrade the bump.
    expect(body).toMatch(/release:\s*minor/i);
  });

  it('errors when there is nothing staged to fold', async () => {
    mkdirSync(join(work, 'dist-action'), { recursive: true });
    writeFileSync(join(work, 'dist-action/index.js'), '// bundle\n', 'utf8');
    git(['add', '-f', 'dist-action/']);
    git(['commit', '-q', '-m', 'seed with bundle already committed']);

    const code = await run([
      'node', 'piot', 'fold-bundle', '--cwd', work, '--subject', 'chore(v0): bundle action',
    ]);

    expect(code).toBe(1);
    expect(out.join('')).toContain(
      'No bundle changes to commit (unexpected — build:action should have produced output).',
    );
  });
});
