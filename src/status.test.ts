/**
 * `computeStatus` / `classify` / `formatStatusRow` unit tests.
 *
 * Drift classification and rendering are pure over {tag, registry}, so
 * they're unit-tested directly. `computeStatus` is exercised against a
 * real temp git repo (real `lastTag` + `parseTagVersion`) with an
 * injected handler standing in for the registry, so the wiring — tag
 * resolution, the per-package registry call, the unreachable catch — is
 * covered without touching the network. The registry-vs-tag drift the
 * feature exists to catch is pinned end-to-end in
 * `test/integration/status.integration.test.ts`.
 *
 * Issue #403.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classify } from './status-classify.js';
import { formatStatusRow } from './status-format.js';
import type { StatusRow } from './status-types.js';
import { computeStatus } from './status.js';
import type { Handler, PackageConfig } from './types.js';

describe('classify', () => {
  it('short-circuits to "registry unreachable" regardless of versions', () => {
    expect(classify('1.0.0', '1.0.0', true)).toBe('registry unreachable');
  });
  it('no tag + no registry → unreleased', () => {
    expect(classify(null, null, false)).toBe('unreleased');
  });
  it('no tag + registry present → published, untagged', () => {
    expect(classify(null, '1.0.0', false)).toBe('published, untagged');
  });
  it('tag present + no registry → tagged, unpublished', () => {
    expect(classify('1.0.0', null, false)).toBe('tagged, unpublished');
  });
  it('tag === registry → in sync', () => {
    expect(classify('1.0.0', '1.0.0', false)).toBe('in sync');
  });
  it('tag !== registry → version mismatch', () => {
    expect(classify('1.0.0', '1.0.1', false)).toBe('version mismatch');
  });
});

describe('formatStatusRow', () => {
  const base: StatusRow = {
    package: 'pkg',
    kind: 'npm',
    tag: null,
    tagVersion: null,
    registry: null,
    registryUnreachable: false,
    state: 'unreleased',
    drift: false,
  };

  it('marks published-but-untagged drift with a warning and an em-dash tag', () => {
    const s = formatStatusRow({
      ...base,
      registry: '1.0.0',
      state: 'published, untagged',
      drift: true,
    });
    expect(s).toContain('pkg');
    expect(s).toContain('tag=—');
    expect(s).toContain('registry=1.0.0');
    expect(s).toContain('⚠');
    expect(s).toContain('published, untagged');
  });

  it('marks tagged-but-unpublished drift with an em-dash registry', () => {
    const s = formatStatusRow({
      ...base,
      tag: 'pkg-v1.0.0',
      tagVersion: '1.0.0',
      state: 'tagged, unpublished',
      drift: true,
    });
    expect(s).toContain('tag=1.0.0');
    expect(s).toContain('registry=—');
    expect(s).toContain('⚠');
  });

  it('marks an unreachable registry with "?" and no version', () => {
    const s = formatStatusRow({ ...base, registryUnreachable: true, state: 'registry unreachable' });
    expect(s).toContain('registry=unreachable');
    expect(s).toContain('?');
  });

  it('marks an in-sync package with a check', () => {
    const s = formatStatusRow({
      ...base,
      tag: 'pkg-v1.0.0',
      tagVersion: '1.0.0',
      registry: '1.0.0',
      state: 'in sync',
    });
    expect(s).toContain('✓');
    expect(s).toContain('in sync');
  });
});

describe('computeStatus', () => {
  let repo: string;

  function git(args: string[]): void {
    execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'status-unit-'));
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
    writeFileSync(
      join(repo, 'putitoutthere.toml'),
      `[putitoutthere]
version = 1
[[package]]
name  = "a"
kind  = "npm"
path  = "a"
globs = ["a/**"]
[[package]]
name  = "b"
kind  = "npm"
path  = "b"
globs = ["b/**"]
[[package]]
name  = "c"
kind  = "npm"
path  = "c"
globs = ["c/**"]
`,
      'utf8',
    );
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);
    // a + c are tagged; b is not.
    git(['tag', '-a', '-m', 'a-v1.0.0', 'a-v1.0.0']);
    git(['tag', '-a', '-m', 'c-v1.0.0', 'c-v1.0.0']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  function handlerReturning(latest: (name: string) => Promise<string | null>): Handler {
    return {
      kind: 'npm',
      isPublished: vi.fn().mockResolvedValue(false),
      latestVersion: (pkg: PackageConfig) => latest(pkg.name),
      trustPosture: vi.fn().mockResolvedValue('token'),
      writeVersion: vi.fn().mockResolvedValue([]),
      publish: vi.fn().mockResolvedValue({ status: 'published', url: 'x' }),
    };
  }

  it('classifies in-sync, published-untagged, and unreachable across packages', async () => {
    const handler = handlerReturning((name) => {
      if (name === 'a') {return Promise.resolve('1.0.0');}  // matches its tag → in sync
      if (name === 'b') {return Promise.resolve('2.0.0');}  // live but no tag → drift
      return Promise.reject(new Error('registry down'));    // c → unreachable
    });

    const rows = await computeStatus({ cwd: repo, handlerFor: () => handler });
    const byName = Object.fromEntries(rows.map((r) => [r.package, r]));

    expect(byName.a!.state).toBe('in sync');
    expect(byName.a!.tagVersion).toBe('1.0.0');
    expect(byName.a!.drift).toBe(false);

    expect(byName.b!.state).toBe('published, untagged');
    expect(byName.b!.tag).toBeNull();
    expect(byName.b!.registry).toBe('2.0.0');
    expect(byName.b!.drift).toBe(true);

    expect(byName.c!.state).toBe('registry unreachable');
    expect(byName.c!.registryUnreachable).toBe(true);
    expect(byName.c!.registry).toBeNull();
    expect(byName.c!.drift).toBe(false);
  });
});
