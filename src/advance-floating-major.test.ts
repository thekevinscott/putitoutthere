/**
 * `advanceFloatingMajor` — move the floating `v<major>` tag to the newest
 * release in its major line (#446). Real git + a real bare remote + a real
 * config file; stdout captured for the log-line assertions.
 *
 * Covers all three branches: the move, the idempotent "already at" no-op,
 * and the "no release tag yet" no-op.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { advanceFloatingMajor } from './advance-floating-major.js';

let repo: string;
let bare: string;
const out: string[] = [];

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeConfig(): void {
  writeFileSync(
    join(repo, 'putitoutthere.toml'),
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
  repo = mkdtempSync(join(tmpdir(), 'piot-afm-'));
  bare = mkdtempSync(join(tmpdir(), 'piot-afm-remote-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
  git(['init', '--bare', '-q'], bare);
  git(['remote', 'add', 'origin', bare]);
  writeConfig();
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'c1']);
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

describe('advanceFloatingMajor', () => {
  it('moves v<major> to the newest release commit on local + remote', () => {
    git(['tag', 'putitoutthere-v0.1.0', 'HEAD']);
    git(['push', '-q', 'origin', 'refs/tags/putitoutthere-v0.1.0']);
    git(['commit', '-q', '--allow-empty', '-m', 'c2']);
    git(['tag', 'putitoutthere-v0.2.0', 'HEAD']);
    git(['push', '-q', 'origin', 'refs/tags/putitoutthere-v0.2.0']);
    const target = git(['rev-parse', 'putitoutthere-v0.2.0^{commit}']);

    const code = advanceFloatingMajor({ cwd: repo });

    expect(code).toBe(0);
    expect(git(['rev-parse', 'v0^{commit}'])).toBe(target);
    expect(git(['rev-parse', 'v0^{commit}'], bare)).toBe(target);
    expect(out.join('')).toBe(
      `Moving floating tag v0 -> ${target} (latest release putitoutthere-v0.2.0)\n`,
    );
  });

  it('picks the highest-semver release (not lexical) across a major boundary', () => {
    git(['tag', 'putitoutthere-v1.2.0', 'HEAD']);
    git(['commit', '-q', '--allow-empty', '-m', 'c2']);
    git(['tag', 'putitoutthere-v1.10.0', 'HEAD']);
    git(['push', '-q', 'origin', 'refs/tags/putitoutthere-v1.10.0']);
    const target = git(['rev-parse', 'putitoutthere-v1.10.0^{commit}']);

    advanceFloatingMajor({ cwd: repo });

    expect(git(['rev-parse', 'v1^{commit}'])).toBe(target);
    expect(out.join('')).toContain('latest release putitoutthere-v1.10.0');
  });

  it('is idempotent: reports no update when the floating tag already matches', () => {
    git(['tag', 'putitoutthere-v2.0.0', 'HEAD']);
    git(['push', '-q', 'origin', 'refs/tags/putitoutthere-v2.0.0']);
    advanceFloatingMajor({ cwd: repo }); // first move
    out.length = 0;

    const code = advanceFloatingMajor({ cwd: repo }); // second run

    expect(code).toBe(0);
    expect(out.join('')).toBe('Floating tag v2 already at putitoutthere-v2.0.0; no update.\n');
  });

  it('no-ops with a message when no release tag exists yet', () => {
    const code = advanceFloatingMajor({ cwd: repo });

    expect(code).toBe(0);
    expect(out.join('')).toBe('No putitoutthere-v* tags yet; nothing to track.\n');
  });
});
