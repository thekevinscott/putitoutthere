/**
 * `foldActionBundle` — synthesize the action-bundle commit (#446). Real git;
 * covers the happy path (body-forwarding commit) and the empty-index guard.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { foldActionBundle } from './fold-action-bundle.js';

let repo: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function stageBundle(): void {
  mkdirSync(join(repo, 'dist-action'), { recursive: true });
  writeFileSync(join(repo, 'dist-action/index.js'), '// bundle\n', 'utf8');
  git(['add', '-f', 'dist-action/']);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-fold-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('foldActionBundle', () => {
  it('commits the staged bundle on top of HEAD, forwarding the parent body', () => {
    writeFileSync(join(repo, 'README.md'), 'hi\n', 'utf8');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'feat: bump\n\nrelease: minor']);
    const parent = git(['rev-parse', 'HEAD']);
    stageBundle();

    const code = foldActionBundle({ cwd: repo, subject: 'chore(v0): bundle action' });

    expect(code).toBe(0);
    expect(git(['rev-parse', 'HEAD^'])).toBe(parent);
    expect(git(['ls-files', 'dist-action/index.js'])).toContain('dist-action/index.js');
    const body = git(['log', '-1', '--format=%B', 'HEAD']);
    expect(body).toMatch(/^chore\(v0\): bundle action/);
    expect(body).toMatch(/release:\s*minor/);
  });

  it('throws the guard message when nothing is staged to fold', () => {
    // Commit the bundle first so a second `git add -f dist-action/` stages
    // no change — the "build:action produced nothing" state.
    stageBundle();
    git(['commit', '-q', '-m', 'seed with bundle']);

    expect(() => foldActionBundle({ cwd: repo, subject: 'chore(release): bundle action' })).toThrow(
      'No bundle changes to commit (unexpected — build:action should have produced output).',
    );
  });
});
