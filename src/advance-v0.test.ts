/**
 * `advanceV0` — force-move the floating `v0` tag to HEAD (#446). Real git +
 * a real bare remote; stdout captured for the log-line assertion.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { advanceV0 } from './advance-v0.js';

let repo: string;
let bare: string;
const out: string[] = [];

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-av0-'));
  bare = mkdtempSync(join(tmpdir(), 'piot-av0-remote-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
  git(['init', '--bare', '-q'], bare);
  git(['remote', 'add', 'origin', bare]);
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of [repo, bare]) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('advanceV0', () => {
  it('force-moves v0 to HEAD on the local repo and the remote, logging the move', () => {
    git(['commit', '-q', '--allow-empty', '-m', 'c1']);
    git(['tag', 'v0', 'HEAD']); // stale v0 at c1
    git(['push', '-q', 'origin', 'refs/tags/v0']);
    git(['commit', '-q', '--allow-empty', '-m', 'c2']);
    const head = git(['rev-parse', 'HEAD']);

    const code = advanceV0({ cwd: repo });

    expect(code).toBe(0);
    expect(git(['rev-parse', 'v0'])).toBe(head);
    expect(git(['rev-parse', 'v0'], bare)).toBe(head);
    expect(out.join('')).toBe(`Moving v0 -> ${head}\n`);
  });
});
