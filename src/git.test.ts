/**
 * Git wrapper tests. Seeds a throwaway git repo in beforeEach and
 * exercises every public function in src/git.ts against it.
 *
 * Issue #9.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  commitBody,
  commitParents,
  createTag,
  diffNames,
  headCommit,
  lastTag,
  pushTag,
  tagList,
} from './git.js';

let repo: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function writeFile(path: string, content: string): void {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function commit(msg: string, opts: { files?: Record<string, string> } = {}): string {
  for (const [p, c] of Object.entries(opts.files ?? {})) {
    writeFile(p, c);
  }
  git(['add', '-A']);
  git(['commit', '-m', msg, '--allow-empty']);
  return git(['rev-parse', 'HEAD']);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'putitoutthere-git-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('headCommit', () => {
  it('returns the current HEAD sha', () => {
    const sha = commit('first');
    expect(headCommit({ cwd: repo })).toBe(sha);
  });
});

describe('commitBody', () => {
  it('returns the body of a commit', () => {
    const sha = commit('subject\n\nline one\nline two\n\nrelease: minor');
    const body = commitBody(sha, { cwd: repo });
    expect(body).toContain('line one');
    expect(body).toContain('release: minor');
  });

  it('throws on an unknown sha', () => {
    expect(() => commitBody('abc0123', { cwd: repo })).toThrow();
  });
});

describe('commitParents', () => {
  it('returns one parent for a plain commit', () => {
    commit('first');
    const second = commit('second');
    const parents = commitParents(second, { cwd: repo });
    expect(parents).toHaveLength(1);
  });

  it('returns zero parents for the root commit', () => {
    const root = commit('root');
    expect(commitParents(root, { cwd: repo })).toEqual([]);
  });

  it('returns two parents for a merge commit', () => {
    commit('base');
    git(['checkout', '-b', 'feat']);
    const featSha = commit('feature work');
    git(['checkout', 'main']);
    git(['merge', '--no-ff', 'feat', '-m', 'Merge feat']);
    const mergeSha = git(['rev-parse', 'HEAD']);
    const parents = commitParents(mergeSha, { cwd: repo });
    expect(parents).toHaveLength(2);
    expect(parents[1]).toBe(featSha);
  });
});

describe('diffNames', () => {
  it('lists files changed between two commits', () => {
    const a = commit('first', { files: { 'a.txt': '1' } });
    commit('second', { files: { 'b.txt': '2' } });
    const names = diffNames(a, 'HEAD', { cwd: repo });
    expect(names).toEqual(['b.txt']);
  });

  it('returns empty when no changes', () => {
    const a = commit('one');
    expect(diffNames(a, 'HEAD', { cwd: repo })).toEqual([]);
  });

  it('handles multi-file commits', () => {
    const a = commit('first', { files: { 'a.txt': '1' } });
    commit('changes', { files: { 'b.txt': '2', 'dir/c.txt': '3' } });
    const names = diffNames(a, 'HEAD', { cwd: repo }).sort();
    expect(names).toEqual(['b.txt', 'dir/c.txt']);
  });
});

describe('createTag + tagList', () => {
  it('creates an annotated tag pointing at a given sha', () => {
    const sha = commit('first');
    createTag('v0.1.0', sha, { cwd: repo, message: 'release 0.1.0' });
    expect(tagList('v*', { cwd: repo })).toEqual(['v0.1.0']);
    expect(git(['rev-list', '-n', '1', 'v0.1.0'])).toBe(sha);
  });

  it('glob filters the list', () => {
    const sha = commit('first');
    createTag('pkg-a-v0.1.0', sha, { cwd: repo });
    createTag('pkg-b-v0.1.0', sha, { cwd: repo });
    expect(tagList('pkg-a-*', { cwd: repo })).toEqual(['pkg-a-v0.1.0']);
  });

  it('returns empty list when no tags match', () => {
    commit('first');
    expect(tagList('never-*', { cwd: repo })).toEqual([]);
  });

  it('throws if a tag already exists at a different sha', () => {
    const a = commit('first');
    const b = commit('second');
    createTag('v0.1.0', a, { cwd: repo });
    expect(() => createTag('v0.1.0', b, { cwd: repo })).toThrow();
  });
});

describe('lastTag', () => {
  it('finds the highest semver among pkg-v*.*.* tags', () => {
    const sha = commit('first');
    for (const v of ['pkg-v0.1.0', 'pkg-v0.1.9', 'pkg-v0.10.0', 'pkg-v0.2.0']) {
      createTag(v, sha, { cwd: repo });
    }
    expect(lastTag('pkg', { cwd: repo })).toBe('pkg-v0.10.0');
  });

  it('returns null when no tags for this package exist', () => {
    commit('first');
    expect(lastTag('pkg', { cwd: repo })).toBeNull();
  });

  it('ignores tags from other packages', () => {
    const sha = commit('first');
    createTag('other-v9.9.9', sha, { cwd: repo });
    createTag('pkg-v0.1.0', sha, { cwd: repo });
    expect(lastTag('pkg', { cwd: repo })).toBe('pkg-v0.1.0');
  });

  it('skips malformed tags under the package prefix', () => {
    const sha = commit('first');
    createTag('pkg-v0.1.0', sha, { cwd: repo });
    createTag('pkg-vnope', sha, { cwd: repo });
    expect(lastTag('pkg', { cwd: repo })).toBe('pkg-v0.1.0');
  });

  it('skips tags matching the glob but rejected by strict semver', () => {
    // `*.*.*` matches `01.02.03` (has three dots). parseSemver rejects
    // leading zeros, so this exercises the try/catch skip path.
    const sha = commit('first');
    createTag('pkg-v0.1.0', sha, { cwd: repo });
    createTag('pkg-v01.02.03', sha, { cwd: repo });
    expect(lastTag('pkg', { cwd: repo })).toBe('pkg-v0.1.0');
  });
});

describe('pushTag', () => {
  it('pushes to origin', () => {
    const bare = mkdtempSync(join(tmpdir(), 'putitoutthere-remote-'));
    try {
      execFileSync('git', ['init', '--bare', '-q', '-b', 'main'], { cwd: bare });
      git(['remote', 'add', 'origin', bare]);

      const sha = commit('first');
      createTag('v0.1.0', sha, { cwd: repo });

      pushTag('v0.1.0', { cwd: repo });

      const remoteTags = execFileSync('git', ['tag', '-l'], {
        cwd: bare,
        encoding: 'utf8',
      }).trim();
      expect(remoteTags).toBe('v0.1.0');
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('error surfacing', () => {
  it('surfaces git stderr in thrown errors', () => {
    expect(() =>
      diffNames('nonexistent-sha-zzz', 'HEAD', { cwd: repo }),
    ).toThrow(/nonexistent-sha-zzz|bad|unknown|revision/i);
  });

  it('throws when run outside a repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'putitoutthere-nonrepo-'));
    try {
      expect(() => headCommit({ cwd: dir })).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
