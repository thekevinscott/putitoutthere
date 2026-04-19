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
    expect(a).toContain('release: minor [dirsql-rust, dirsql-python]');
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

  it('skips CLAUDE.md append when import is already present', () => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# stuff\n@putitoutthere/AGENTS.md\n');
    const r = init({ cwd: repo });
    expect(r.skipped).toContain('CLAUDE.md');
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

  it('skips re-writing AGENTS.md if it already exists', () => {
    const agentsPath = join(repo, 'putitoutthere', 'AGENTS.md');
    mkdirSync(join(repo, 'putitoutthere'), { recursive: true });
    writeFileSync(agentsPath, '# custom agents doc\n');
    const r = init({ cwd: repo });
    expect(r.skipped).toContain('putitoutthere/AGENTS.md');
    expect(readFileSync(agentsPath, 'utf8')).toBe('# custom agents doc\n');
  });
});
