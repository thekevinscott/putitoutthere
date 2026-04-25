/**
 * npm platform-package orchestration tests.
 *
 * Mocks `execFileSync` so we can assert every npm invocation (platform
 * publishes, then main) and stub per-package `isPublished` lookups.
 *
 * Issue #19. Plan: §13.7.
 */

import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  platformPackageName,
  publishPlatforms,
  targetToOsCpu,
  type PlatformPkg,
} from './npm-platform.js';
import type { Ctx } from '../types.js';

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const execMock = vi.mocked(execFileSync);

let repo: string;
let artifactsRoot: string;

function makeCtx(over: Partial<Ctx> = {}): Ctx {
  return {
    cwd: repo,
    dryRun: false,
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    env: {},
    artifacts: { get: () => '', has: () => false },
    artifactsRoot,
    ...over,
  };
}

function makeArtifact(target: string, fileName: string, contents: Buffer | string): void {
  const dir = join(artifactsRoot, `demo-cli-${target}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), contents);
}

function basePkg(over: Partial<PlatformPkg> = {}): PlatformPkg {
  return {
    name: 'demo-cli',
    path: join(repo, 'pkg'),
    build: 'napi',
    targets: ['linux-x64-gnu', 'darwin-arm64'],
    ...over,
  };
}

beforeEach(() => {
  execMock.mockReset();
  repo = mkdtempSync(join(tmpdir(), 'npm-plat-test-'));
  artifactsRoot = join(repo, 'artifacts');
  mkdirSync(artifactsRoot, { recursive: true });
  mkdirSync(join(repo, 'pkg'), { recursive: true });
  writeFileSync(
    join(repo, 'pkg', 'package.json'),
    JSON.stringify({ name: 'demo-cli', version: '0.0.0' }, null, 2),
  );
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('platformPackageName', () => {
  it('handles unscoped names', () => {
    expect(platformPackageName('demo-cli', 'linux-x64-gnu')).toBe('demo-cli-linux-x64-gnu');
  });

  it('handles scoped names', () => {
    expect(platformPackageName('@acme/demo-cli', 'linux-x64-gnu')).toBe('@acme/demo-cli-linux-x64-gnu');
  });
});

describe('targetToOsCpu', () => {
  it('maps linux-x64-gnu → os:linux cpu:x64 libc:glibc', () => {
    expect(targetToOsCpu('linux-x64-gnu')).toEqual({
      os: ['linux'],
      cpu: ['x64'],
      libc: ['glibc'],
    });
  });

  it('maps linux-x64-musl → libc:musl', () => {
    expect(targetToOsCpu('linux-x64-musl').libc).toEqual(['musl']);
  });

  it('maps darwin-arm64 → os:darwin cpu:arm64', () => {
    expect(targetToOsCpu('darwin-arm64')).toEqual({ os: ['darwin'], cpu: ['arm64'] });
  });

  it('maps aarch64-unknown-linux-gnu → linux arm64 glibc', () => {
    expect(targetToOsCpu('aarch64-unknown-linux-gnu')).toEqual({
      os: ['linux'],
      cpu: ['arm64'],
      libc: ['glibc'],
    });
  });

  it('maps x86_64-pc-windows-msvc → os:win32 cpu:x64', () => {
    expect(targetToOsCpu('x86_64-pc-windows-msvc')).toEqual({ os: ['win32'], cpu: ['x64'] });
  });

  it('throws a descriptive error for unknown triples (#170)', () => {
    expect(() => targetToOsCpu('riscv64-unknown-linux-gnu')).toThrow(
      /riscv64-unknown-linux-gnu.*TRIPLE_MAP.*src\/handlers\/npm-platform\.ts/,
    );
  });
});

describe('publishPlatforms (napi)', () => {
  beforeEach(() => {
    makeArtifact('linux-x64-gnu', 'demo-cli.linux-x64-gnu.node', Buffer.from('napi-bytes-linux'));
    makeArtifact('darwin-arm64', 'demo-cli.darwin-arm64.node', Buffer.from('napi-bytes-darwin'));
  });

  it('publishes each platform package and rewrites optionalDependencies', async () => {
    // All `npm view` calls → 404 (not published).
    // All `npm publish` calls → succeed (return Buffer).
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      return Buffer.from('');
    });

    const r = await publishPlatforms(basePkg(), '0.2.0', makeCtx());
    expect(r.published).toEqual(['demo-cli-linux-x64-gnu', 'demo-cli-darwin-arm64']);

    const pkgJson = JSON.parse(readFileSync(join(repo, 'pkg', 'package.json'), 'utf8')) as {
      optionalDependencies: Record<string, string>;
    };
    expect(pkgJson.optionalDependencies).toEqual({
      'demo-cli-linux-x64-gnu': '0.2.0',
      'demo-cli-darwin-arm64': '0.2.0',
    });
  });

  it('skips platform packages that are already published', async () => {
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view' && String(a[1]).includes('linux-x64-gnu')) return Buffer.from('0.2.0\n');
      if (a[0] === 'view') throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      return Buffer.from('');
    });

    const r = await publishPlatforms(basePkg(), '0.2.0', makeCtx());
    expect(r.skipped).toContain('demo-cli-linux-x64-gnu');
    expect(r.published).toEqual(['demo-cli-darwin-arm64']);
    // Already-published platforms still end up in optionalDependencies.
    const pkgJson = JSON.parse(readFileSync(join(repo, 'pkg', 'package.json'), 'utf8')) as {
      optionalDependencies: Record<string, string>;
    };
    expect(pkgJson.optionalDependencies['demo-cli-linux-x64-gnu']).toBe('0.2.0');
    expect(pkgJson.optionalDependencies['demo-cli-darwin-arm64']).toBe('0.2.0');
  });

  it('throws if any platform publish fails BEFORE rewriting main', async () => {
    // linux view → 404, linux publish → throw.
    // darwin shouldn't even get called.
    let calls = 0;
    execMock.mockImplementation((_cmd, args) => {
      calls++;
      const a = args as string[];
      if (a[0] === 'view') throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      if (a[0] === 'publish') throw Object.assign(new Error('boom'), { status: 1, stderr: Buffer.from('registry error') });
      return Buffer.from('');
    });

    await expect(publishPlatforms(basePkg(), '0.2.0', makeCtx())).rejects.toThrow(/platform/);

    // Main package.json must NOT have optionalDependencies.
    const pkgJson = JSON.parse(readFileSync(join(repo, 'pkg', 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkgJson.optionalDependencies).toBeUndefined();
    expect(calls).toBeGreaterThan(0);
  });

  it('dry-run lists platforms but does not invoke npm publish', async () => {
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      throw new Error('publish should not be called in dry-run');
    });
    const r = await publishPlatforms(basePkg(), '0.2.0', makeCtx({ dryRun: true }));
    expect(r.skipped).toEqual(['demo-cli-linux-x64-gnu', 'demo-cli-darwin-arm64']);
    expect(r.published).toEqual([]);
    const pkgJson = JSON.parse(readFileSync(join(repo, 'pkg', 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkgJson.optionalDependencies).toBeUndefined();
  });
});

describe('publishPlatforms (bundled-cli)', () => {
  it('synthesized platform package.json picks the executable as main', async () => {
    mkdirSync(join(artifactsRoot, 'demo-cli-linux-x64-gnu'), { recursive: true });
    writeFileSync(join(artifactsRoot, 'demo-cli-linux-x64-gnu', 'demo-cli'), Buffer.from('#!/bin/bash\n'));

    const stagingPkgJsons: Record<string, unknown>[] = [];
    execMock.mockImplementation((_cmd, args, opts) => {
      const a = args as string[];
      if (a[0] === 'view') throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      // Inspect the staging dir's package.json before npm publish.
      const cwd = (opts as { cwd?: string } | undefined)?.cwd;
      if (cwd) {
        stagingPkgJsons.push(JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>);
      }
      return Buffer.from('');
    });

    const pkg: PlatformPkg = basePkg({
      build: 'bundled-cli',
      targets: ['linux-x64-gnu'],
    });
    const r = await publishPlatforms(pkg, '0.2.0', makeCtx());
    expect(r.published).toEqual(['demo-cli-linux-x64-gnu']);
    expect(stagingPkgJsons).toHaveLength(1);
    expect(stagingPkgJsons[0]!.main).toBe('demo-cli');
  });
});

describe('publishPlatforms + scoped main package', () => {
  it('synthesizes @scope/name-{target}', async () => {
    makeArtifact('linux-x64-gnu', 'demo.linux-x64-gnu.node', Buffer.from('x'));
    // Sanity: `npm view` call uses the scoped platform name.
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {
        if (!String(a[1]).startsWith('@acme/demo-cli-linux-x64-gnu@')) {
          throw new Error(`unexpected view target: ${a[1]}`);
        }
        throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      }
      return Buffer.from('');
    });

    const pkg: PlatformPkg = basePkg({
      npm: '@acme/demo-cli',
      targets: ['linux-x64-gnu'],
    });
    const r = await publishPlatforms(pkg, '0.1.0', makeCtx());
    expect(r.published).toEqual(['@acme/demo-cli-linux-x64-gnu']);
  });
});

describe('publishPlatforms: publish flags', () => {
  it('passes --access and --tag when set on the package', async () => {
    makeArtifact('linux-x64-gnu', 'demo.node', Buffer.from('x'));
    const calls: string[][] = [];
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      calls.push(a);
      if (a[0] === 'view') throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      return Buffer.from('');
    });
    await publishPlatforms(
      basePkg({ targets: ['linux-x64-gnu'], access: 'restricted', tag: 'next' }),
      '0.1.0',
      makeCtx(),
    );
    const publishCall = calls.find((c) => c[0] === 'publish');
    expect(publishCall).toContain('--access=restricted');
    expect(publishCall).toContain('--tag=next');
  });

  it('adds --provenance when ACTIONS_ID_TOKEN_REQUEST_TOKEN is present', async () => {
    makeArtifact('linux-x64-gnu', 'demo.node', Buffer.from('x'));
    const calls: string[][] = [];
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      calls.push(a);
      if (a[0] === 'view') throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      return Buffer.from('');
    });
    await publishPlatforms(
      basePkg({ targets: ['linux-x64-gnu'] }),
      '0.1.0',
      makeCtx({ env: { ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'y' } }),
    );
    const publishCall = calls.find((c) => c[0] === 'publish');
    expect(publishCall).toContain('--provenance');
  });

  it('merges onto existing optionalDependencies rather than replacing', async () => {
    makeArtifact('linux-x64-gnu', 'demo.node', Buffer.from('x'));
    writeFileSync(
      join(repo, 'pkg', 'package.json'),
      JSON.stringify({ name: 'demo-cli', version: '0.0.0', optionalDependencies: { 'other-dep': '^1.0.0' } }, null, 2),
    );
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      return Buffer.from('');
    });
    await publishPlatforms(basePkg({ targets: ['linux-x64-gnu'] }), '0.2.0', makeCtx());
    const pkgJson = JSON.parse(readFileSync(join(repo, 'pkg', 'package.json'), 'utf8')) as {
      optionalDependencies: Record<string, string>;
    };
    expect(pkgJson.optionalDependencies['other-dep']).toBe('^1.0.0');
    expect(pkgJson.optionalDependencies['demo-cli-linux-x64-gnu']).toBe('0.2.0');
  });
});

describe('artifact path resolution', () => {
  it('falls back to ctx.cwd/artifacts when artifactsRoot is unset', () => {
    makeArtifact('linux-x64-gnu', 'demo.node', Buffer.from('x'));
    // Not a real published-end-to-end test; just existence.
    expect(existsSync(join(repo, 'artifacts', 'demo-cli-linux-x64-gnu'))).toBe(true);
  });

  // #237: slash-containing pkg.name (polyglot-monorepo grouping shape)
  // resolves to the encoded artifact directory the planner emitted.
  it('encodes `/` in pkg.name when looking up the artifact directory', async () => {
    // On-disk dir uses the encoded name; the lookup must match it.
    const dir = join(artifactsRoot, 'js__cachetta-linux-x64-gnu');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'cachetta.linux-x64-gnu.node'), Buffer.from('napi-bytes'));
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      return Buffer.from('');
    });
    const r = await publishPlatforms(
      basePkg({ name: 'js/cachetta', targets: ['linux-x64-gnu'] }),
      '0.3.1',
      makeCtx(),
    );
    expect(r.published).toEqual(['js/cachetta-linux-x64-gnu']);
  });
});
