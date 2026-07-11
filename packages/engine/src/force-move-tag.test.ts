/**
 * `forceMoveTag` — the shared local-write + ref-scoped force-push both
 * floating-tag advancers use (#446). Real git + a real bare remote.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { forceMoveTag } from './force-move-tag.js';

let repo: string;
let bare: string;

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-fmt-'));
  bare = mkdtempSync(join(tmpdir(), 'piot-fmt-remote-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
  git(['init', '--bare', '-q'], bare);
  git(['remote', 'add', 'origin', bare]);
});

afterEach(() => {
  for (const d of [repo, bare]) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('forceMoveTag', () => {
  it('writes the tag locally and force-pushes it ref-scoped to the remote', () => {
    git(['commit', '-q', '--allow-empty', '-m', 'c1']);
    const head = git(['rev-parse', 'HEAD']);
    forceMoveTag('v0', head, { cwd: repo });
    expect(git(['rev-parse', 'v0'])).toBe(head);
    expect(git(['rev-parse', 'v0'], bare)).toBe(head);
  });

  it('overwrites a diverged remote tag (force path)', () => {
    git(['commit', '-q', '--allow-empty', '-m', 'c1']);
    const first = git(['rev-parse', 'HEAD']);
    forceMoveTag('v0', first, { cwd: repo });
    git(['commit', '-q', '--allow-empty', '-m', 'c2']);
    const second = git(['rev-parse', 'HEAD']);
    forceMoveTag('v0', second, { cwd: repo });
    expect(git(['rev-parse', 'v0'], bare)).toBe(second);
  });
});
