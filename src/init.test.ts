/**
 * `putitoutthere init` tests. Covers:
 * - Fresh-repo scaffold writes all expected files.
 * - Idempotency: re-running skips existing files without --force.
 * - --force overwrites putitoutthere.toml.
 * - Workflow rename-to-.bak when pre-existing.
 * - CLAUDE.md append + idempotent re-append.
 * - CLAUDE.md created from scratch when absent.
 *
 * Issue #20. Plan: §17.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { init } from './init.js';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'init-test-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('init', () => {
  it('writes all scaffold files on a fresh repo', () => {
    const r = init({ cwd: repo });

    expect(existsSync(join(repo, 'putitoutthere.toml'))).toBe(true);
    expect(existsSync(join(repo, 'putitoutthere', 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(repo, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(repo, '.github', 'workflows', 'release.yml'))).toBe(true);
    expect(existsSync(join(repo, '.github', 'workflows', 'putitoutthere-check.yml'))).toBe(true);

    expect(r.wrote).toContain('putitoutthere.toml');
    expect(r.wrote).toContain('putitoutthere/AGENTS.md');
    expect(r.wrote).toContain('CLAUDE.md');
    expect(r.wrote).toContain('.github/workflows/release.yml');
    expect(r.wrote).toContain('.github/workflows/putitoutthere-check.yml');
    expect(r.skipped).toEqual([]);
    expect(r.alreadyPresent).toEqual([]);
    expect(r.backedUp).toEqual([]);
  });

  it('putitoutthere.toml contains version = 1 and commented example block', () => {
    init({ cwd: repo });
    const t = readFileSync(join(repo, 'putitoutthere.toml'), 'utf8');
    expect(t).toContain('version = 1');
    expect(t).toContain('[[package]]');
    expect(t).toContain('kind = "crates"');
  });

  it('AGENTS.md contains the trailer convention doc', () => {
    init({ cwd: repo });
    const a = readFileSync(join(repo, 'putitoutthere', 'AGENTS.md'), 'utf8');
    expect(a).toContain('release: <patch|minor|major|skip>');
    expect(a).toContain('Squash and merge');
    expect(a).toContain('release: minor [my-crate, my-py]');
  });

  it('CLAUDE.md gets @putitoutthere/AGENTS.md appended', () => {
    init({ cwd: repo });
    const c = readFileSync(join(repo, 'CLAUDE.md'), 'utf8');
    expect(c).toContain('@putitoutthere/AGENTS.md');
  });

  it('preserves existing CLAUDE.md content and appends on new line', () => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# Project notes\n\nSome notes here.');
    init({ cwd: repo });
    const c = readFileSync(join(repo, 'CLAUDE.md'), 'utf8');
    expect(c).toContain('# Project notes');
    expect(c).toContain('Some notes here.');
    expect(c).toContain('@putitoutthere/AGENTS.md');
    expect(c.endsWith('@putitoutthere/AGENTS.md\n')).toBe(true);
  });

  it('appends a separator newline if CLAUDE.md lacks a trailing newline', () => {
    writeFileSync(join(repo, 'CLAUDE.md'), 'no trailing newline');
    init({ cwd: repo });
    const c = readFileSync(join(repo, 'CLAUDE.md'), 'utf8');
    expect(c).toBe('no trailing newline\n@putitoutthere/AGENTS.md\n');
  });

  it('marks CLAUDE.md as already-present when import is already there (#131)', () => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# stuff\n@putitoutthere/AGENTS.md\n');
    const r = init({ cwd: repo });
    expect(r.alreadyPresent).toContain('CLAUDE.md');
    expect(r.skipped).not.toContain('CLAUDE.md');
    const c = readFileSync(join(repo, 'CLAUDE.md'), 'utf8');
    expect(c.match(/@putitoutthere\/AGENTS\.md/g)).toHaveLength(1);
  });

  it('skips putitoutthere.toml if it exists (no --force)', () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), '# user-edited\nversion = 1\n');
    const r = init({ cwd: repo });
    expect(r.skipped).toContain('putitoutthere.toml');
    const t = readFileSync(join(repo, 'putitoutthere.toml'), 'utf8');
    expect(t).toContain('# user-edited');
  });

  it('overwrites putitoutthere.toml when --force is set', () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), '# user-edited\n');
    const r = init({ cwd: repo, force: true });
    expect(r.wrote).toContain('putitoutthere.toml');
    const t = readFileSync(join(repo, 'putitoutthere.toml'), 'utf8');
    expect(t).not.toContain('# user-edited');
    expect(t).toContain('version = 1');
  });

  it('renames existing workflow to .bak before writing', () => {
    const wfDir = join(repo, '.github', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'release.yml'), '# pre-existing user workflow\n');

    const r = init({ cwd: repo });
    expect(r.backedUp).toContain('.github/workflows/release.yml');
    expect(existsSync(join(wfDir, 'release.yml.bak'))).toBe(true);
    const bak = readFileSync(join(wfDir, 'release.yml.bak'), 'utf8');
    expect(bak).toContain('# pre-existing user workflow');
    const fresh = readFileSync(join(wfDir, 'release.yml'), 'utf8');
    expect(fresh).toContain('name: Release');
  });

  it('skips .bak when an existing workflow is byte-identical (#148)', () => {
    // First run creates the workflow files.
    init({ cwd: repo });
    const wfDir = join(repo, '.github', 'workflows');
    const before = readFileSync(join(wfDir, 'release.yml'), 'utf8');

    // Second run: the files on disk already match what init would
    // write, so no .bak should be created and the file should be
    // untouched.
    const r = init({ cwd: repo });
    expect(r.backedUp).not.toContain('.github/workflows/release.yml');
    expect(r.alreadyPresent).toContain('.github/workflows/release.yml');
    expect(existsSync(join(wfDir, 'release.yml.bak'))).toBe(false);
    expect(readFileSync(join(wfDir, 'release.yml'), 'utf8')).toBe(before);
  });

  it('still writes .bak when the workflow differs (#148)', () => {
    init({ cwd: repo });
    const wfDir = join(repo, '.github', 'workflows');
    writeFileSync(join(wfDir, 'release.yml'), '# user-edited workflow\n');

    const r = init({ cwd: repo });
    expect(r.backedUp).toContain('.github/workflows/release.yml');
    expect(existsSync(join(wfDir, 'release.yml.bak'))).toBe(true);
    expect(readFileSync(join(wfDir, 'release.yml.bak'), 'utf8')).toBe(
      '# user-edited workflow\n',
    );
  });

  it('marks AGENTS.md as already-present when it already exists (#131)', () => {
    const agentsPath = join(repo, 'putitoutthere', 'AGENTS.md');
    mkdirSync(join(repo, 'putitoutthere'), { recursive: true });
    writeFileSync(agentsPath, '# custom agents doc\n');
    const r = init({ cwd: repo });
    expect(r.alreadyPresent).toContain('putitoutthere/AGENTS.md');
    expect(r.skipped).not.toContain('putitoutthere/AGENTS.md');
    expect(readFileSync(agentsPath, 'utf8')).toBe('# custom agents doc\n');
  });

  it('suggests tag_format = "v{version}" when existing v* tags are present and there are no <name>-v* tags (#204)', () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 't@e.c'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });
    writeFileSync(join(repo, 'x'), 'x');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
    execFileSync('git', ['tag', 'v0.1.0'], { cwd: repo });
    execFileSync('git', ['tag', 'v0.2.0'], { cwd: repo });

    const r = init({ cwd: repo });

    expect(r.notes.some((n) => n.includes('v{version}'))).toBe(true);
    const toml = readFileSync(join(repo, 'putitoutthere.toml'), 'utf8');
    expect(toml).toContain('existing v*-style tag history');
    // The suggestion should reference the concrete tags it saw.
    expect(toml).toMatch(/v0\.[12]\.0/);
  });

  it('truncates the sampled tag list with `, …` past three entries', () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 't@e.c'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });
    writeFileSync(join(repo, 'x'), 'x');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
    for (const v of ['v0.1.0', 'v0.2.0', 'v0.3.0', 'v0.4.0', 'v0.5.0']) {
      execFileSync('git', ['tag', v], { cwd: repo });
    }

    const r = init({ cwd: repo });

    expect(r.notes[0]).toContain(', …');
    const toml = readFileSync(join(repo, 'putitoutthere.toml'), 'utf8');
    expect(toml).toContain(', …');
  });

  it('does NOT suggest v{version} when <name>-v* tags are present (polyglot shape)', () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 't@e.c'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });
    writeFileSync(join(repo, 'x'), 'x');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
    execFileSync('git', ['tag', 'v0.1.0'], { cwd: repo });
    execFileSync('git', ['tag', 'my-crate-v0.1.0'], { cwd: repo });

    const r = init({ cwd: repo });

    expect(r.notes.filter((n) => n.includes('tag_format'))).toEqual([]);
    const toml = readFileSync(join(repo, 'putitoutthere.toml'), 'utf8');
    expect(toml).not.toContain('existing v*-style tag history');
  });

  it('does NOT suggest v{version} on a repo with no tags', () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 't@e.c'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });
    writeFileSync(join(repo, 'x'), 'x');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });

    const r = init({ cwd: repo });

    expect(r.notes).toEqual([]);
  });

  it('init on a non-git directory does not crash and emits no tag_format note', () => {
    const r = init({ cwd: repo });
    expect(r.notes).toEqual([]);
    expect(existsSync(join(repo, 'putitoutthere.toml'))).toBe(true);
  });

  it('only `putitoutthere.toml` lands in `skipped` — the --force-gated set (#131)', () => {
    // Pre-populate everything so every step takes its "already" branch.
    writeFileSync(join(repo, 'putitoutthere.toml'), '# user-edited\nversion = 1\n');
    mkdirSync(join(repo, 'putitoutthere'), { recursive: true });
    writeFileSync(join(repo, 'putitoutthere', 'AGENTS.md'), 'custom\n');
    writeFileSync(join(repo, 'CLAUDE.md'), '@putitoutthere/AGENTS.md\n');

    const r = init({ cwd: repo });

    // Only `putitoutthere.toml` is `--force`-gated, so only it goes into
    // `skipped`. Everything else is already-present.
    expect(r.skipped).toEqual(['putitoutthere.toml']);
    expect(r.alreadyPresent.sort()).toEqual(['CLAUDE.md', 'putitoutthere/AGENTS.md']);
  });
});
