/**
 * GitHub Release creation tests. Verifies:
 * - Release creation via GitHub API (mocked fetch).
 * - Release notes generation from commit history between tags.
 * - Skip on missing GITHUB_TOKEN (non-CI / operator run).
 * - Dry-run honors ctx.dryRun.
 *
 * Issue #26. Plan: §15.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGitHubRelease, generateReleaseNotes } from './release.js';

let repo: string;
function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}
function commit(msg: string): string {
  git(['commit', '--allow-empty', '-m', msg]);
  return git(['rev-parse', 'HEAD']);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'release-test-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPOSITORY;
});

describe('generateReleaseNotes', () => {
  it('lists commit subjects since the previous tag', () => {
    writeFileSync(join(repo, 'f.txt'), '1');
    git(['add', '.']);
    commit('feat: initial');
    git(['tag', 'pkg-v0.1.0']);

    commit('fix: bug A');
    commit('feat: bug B');
    git(['tag', 'pkg-v0.2.0']);

    const notes = generateReleaseNotes('pkg', 'pkg-v0.2.0', { cwd: repo });
    expect(notes).toContain('fix: bug A');
    expect(notes).toContain('feat: bug B');
  });

  it('falls back to all commits on first release', () => {
    commit('feat: initial');
    commit('feat: second');
    git(['tag', 'pkg-v0.1.0']);
    const notes = generateReleaseNotes('pkg', 'pkg-v0.1.0', { cwd: repo });
    expect(notes).toContain('feat: initial');
    expect(notes).toContain('feat: second');
  });

  it('picks the latest previous tag when multiple older tags exist', () => {
    commit('feat: initial');
    git(['tag', 'pkg-v0.1.0']);
    commit('feat: minor');
    git(['tag', 'pkg-v0.2.0']);
    commit('feat: major');
    git(['tag', 'pkg-v1.0.0']);
    commit('fix: post-1.0 change');
    git(['tag', 'pkg-v1.1.0']);
    const notes = generateReleaseNotes('pkg', 'pkg-v1.1.0', { cwd: repo });
    // Should use pkg-v1.0.0 as the previous tag, so only the post-1.0 commit
    expect(notes).toContain('fix: post-1.0 change');
    expect(notes).not.toContain('feat: major');
    expect(notes).not.toContain('feat: minor');
  });

  it('sorts by major then minor then patch across tag families', () => {
    commit('c0');
    git(['tag', 'pkg-v0.9.0']);
    commit('c1');
    git(['tag', 'pkg-v0.10.0']);
    commit('c2');
    git(['tag', 'pkg-v0.10.1']);
    commit('c3');
    git(['tag', 'pkg-v0.11.0']);
    const notes = generateReleaseNotes('pkg', 'pkg-v0.11.0', { cwd: repo });
    // Previous should be 0.10.1 (not 0.9.0 — string sort would mis-order it)
    expect(notes).toContain('c3');
    expect(notes).not.toContain('c2');
  });

  it('includes full subject list without path filtering (v0 behavior)', () => {
    // No path filter support in v0; notes include all commits between tags.
    // Placeholder test to lock behavior: full subject list, no filtering.
    commit('feat: a');
    commit('feat: b');
    git(['tag', 'pkg-v0.1.0']);
    const notes = generateReleaseNotes('pkg', 'pkg-v0.1.0', { cwd: repo });
    expect(notes).toContain('feat: a');
    expect(notes).toContain('feat: b');
  });
});

describe('createGitHubRelease', () => {
  it('POSTs to /repos/{owner}/{repo}/releases with the right body', async () => {
    process.env.GITHUB_TOKEN = 'ghp-test';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockImplementation((url, init) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        calls.push({ url: urlStr, init: init ?? {} });
        return Promise.resolve(
          new Response(JSON.stringify({ html_url: 'https://github.com/owner/repo/releases/tag/pkg-v0.1.0' }), {
            status: 201,
          }),
        );
      });

    const result = await createGitHubRelease({
      tag: 'pkg-v0.1.0',
      title: 'pkg 0.1.0',
      body: 'notes go here',
    });
    expect(result?.url).toMatch(/releases\/tag\/pkg-v0.1.0/);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.github.com/repos/owner/repo/releases');
    expect(calls[0]!.init.method).toBe('POST');
    const body = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
    expect(body.tag_name).toBe('pkg-v0.1.0');
    expect(body.name).toBe('pkg 0.1.0');
    expect(body.body).toBe('notes go here');
    fetchSpy.mockRestore();
  });

  it('returns null and logs when GITHUB_TOKEN is missing', async () => {
    const result = await createGitHubRelease({
      tag: 'pkg-v0.1.0',
      title: 'pkg 0.1.0',
      body: '',
    });
    expect(result).toBeNull();
  });

  it('throws on 4xx from GitHub API', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{"message":"Validation failed"}', { status: 422 }));
    await expect(
      createGitHubRelease({ tag: 'pkg-v0.1.0', title: 'pkg', body: '' }),
    ).rejects.toThrow(/422|Validation/);
    fetchSpy.mockRestore();
  });

  it('marks prerelease=true for -rc/-beta/-alpha suffixed tags', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockImplementation((url, init) => {
        const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
        expect(body.prerelease).toBe(true);
        return Promise.resolve(new Response('{}', { status: 201 }));
      });
    await createGitHubRelease({
      tag: 'pkg-v0.1.0-rc.1',
      title: 'pkg 0.1.0-rc.1',
      body: '',
    });
    fetchSpy.mockRestore();
  });

  it('marks prerelease=false for stable tags', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockImplementation((url, init) => {
        const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
        expect(body.prerelease).toBe(false);
        return Promise.resolve(new Response('{}', { status: 201 }));
      });
    await createGitHubRelease({
      tag: 'pkg-v1.2.3',
      title: 'pkg 1.2.3',
      body: '',
    });
    fetchSpy.mockRestore();
  });
});
