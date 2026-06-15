import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureTag } from './ensure-tag.js';
import type { Logger } from './types.js';

let repo: string;
let head: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function makeLog(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-ensuretag-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
  git(['commit', '-q', '--allow-empty', '-m', 'init']);
  head = git(['rev-parse', 'HEAD']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('ensureTag', () => {
  it('creates the missing tag (and warns when the push fails — no remote here)', () => {
    const log = makeLog();
    ensureTag('{name}-v{version}', 'lib', '1.0.0', head, { cwd: repo }, log);
    expect(git(['tag', '-l'])).toContain('lib-v1.0.0');
    // The throwaway repo has no `origin`, so the push fails and is warned.
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('is a no-op when the tag already exists', () => {
    git(['tag', 'lib-v1.0.0', head]);
    const log = makeLog();
    ensureTag('{name}-v{version}', 'lib', '1.0.0', head, { cwd: repo }, log);
    // Still present, and we neither re-created nor tried to push it.
    expect(git(['tag', '-l'])).toContain('lib-v1.0.0');
    expect(log.warn).not.toHaveBeenCalled();
  });
});
