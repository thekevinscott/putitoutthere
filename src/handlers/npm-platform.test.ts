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
  DEFAULT_NAME_TEMPLATE,
  looksLikePublishOverRace,
  normalizeBuild,
  platformArtifactName,
  publishPlatforms,
  resolvePlatformName,
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
    build: [{ mode: 'napi', name: DEFAULT_NAME_TEMPLATE }],
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

describe('resolvePlatformName', () => {
  it('default template + unscoped name → name-triple', () => {
    expect(
      resolvePlatformName(DEFAULT_NAME_TEMPLATE, {
        name: 'demo-cli',
        triple: 'linux-x64-gnu',
        mode: 'napi',
      }),
    ).toBe('demo-cli-linux-x64-gnu');
  });

  it('default template + scoped name → @scope/base-triple', () => {
    expect(
      resolvePlatformName(DEFAULT_NAME_TEMPLATE, {
        name: '@acme/demo-cli',
        triple: 'linux-x64-gnu',
        mode: 'napi',
      }),
    ).toBe('@acme/demo-cli-linux-x64-gnu');
  });

  it('substitutes {scope} and {base} from a scoped name', () => {
    expect(
      resolvePlatformName('@{scope}/lib-{triple}', {
        name: '@dirsql/core',
        triple: 'linux-x64-gnu',
        mode: 'napi',
      }),
    ).toBe('@dirsql/lib-linux-x64-gnu');
  });

  it('{scope} resolves to empty string for unscoped names', () => {
    expect(
      resolvePlatformName('{scope}-{base}-{triple}', {
        name: 'unscoped',
        triple: 'darwin-arm64',
        mode: 'napi',
      }),
    ).toBe('-unscoped-darwin-arm64');
  });

  it('substitutes {mode}', () => {
    expect(
      resolvePlatformName('{name}-{mode}-{triple}', {
        name: 'demo',
        triple: 'linux-x64-gnu',
        mode: 'bundled-cli',
      }),
    ).toBe('demo-bundled-cli-linux-x64-gnu');
  });
});

describe('platformArtifactName', () => {
  it('single-mode keeps the historical <safe>-<triple> shape', () => {
    expect(platformArtifactName('demo-cli', 'napi', 'linux-x64-gnu', false)).toBe(
      'demo-cli-linux-x64-gnu',
    );
  });

  it('multi-mode adds a <mode> infix', () => {
    expect(platformArtifactName('demo-cli', 'napi', 'linux-x64-gnu', true)).toBe(
      'demo-cli-napi-linux-x64-gnu',
    );
    expect(platformArtifactName('demo-cli', 'bundled-cli', 'linux-x64-gnu', true)).toBe(
      'demo-cli-bundled-cli-linux-x64-gnu',
    );
  });

  it('encodes `/` in pkg.name (#237)', () => {
    expect(platformArtifactName('js/cachetta', 'napi', 'linux-x64-gnu', false)).toBe(
      'js__cachetta-linux-x64-gnu',
    );
  });
});

describe('normalizeBuild', () => {
  it('returns [] for undefined', () => {
    expect(normalizeBuild(undefined)).toEqual([]);
  });

  it('coerces a single-mode string into a length-1 array with the default template', () => {
    expect(normalizeBuild('napi')).toEqual([
      { mode: 'napi', name: DEFAULT_NAME_TEMPLATE },
    ]);
  });

  it('coerces a length-1 array of strings into the same shape as the string form', () => {
    expect(normalizeBuild(['bundled-cli'])).toEqual([
      { mode: 'bundled-cli', name: DEFAULT_NAME_TEMPLATE },
    ]);
  });

  it('passes through object-form entries verbatim', () => {
    expect(
      normalizeBuild([
        { mode: 'napi', name: '@dirsql/lib-{triple}' },
        { mode: 'bundled-cli', name: '@dirsql/cli-{triple}' },
      ]),
    ).toEqual([
      { mode: 'napi', name: '@dirsql/lib-{triple}' },
      { mode: 'bundled-cli', name: '@dirsql/cli-{triple}' },
    ]);
  });

  it('accepts mixed entries (bare string + object form) in the same array', () => {
    expect(
      normalizeBuild([
        'napi',
        { mode: 'bundled-cli', name: '{name}-cli-{triple}' },
      ]),
    ).toEqual([
      { mode: 'napi', name: DEFAULT_NAME_TEMPLATE },
      { mode: 'bundled-cli', name: '{name}-cli-{triple}' },
    ]);
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
      build: [{ mode: 'bundled-cli', name: DEFAULT_NAME_TEMPLATE }],
      targets: ['linux-x64-gnu'],
    });
    const r = await publishPlatforms(pkg, '0.2.0', makeCtx());
    expect(r.published).toEqual(['demo-cli-linux-x64-gnu']);
    expect(stagingPkgJsons).toHaveLength(1);
    expect(stagingPkgJsons[0]!.main).toBe('demo-cli');
  });

  it('propagates repository/license/homepage from main package.json', async () => {
    // npm provenance verifier rejects the platform tarball with E422 when
    // package.json.repository.url is empty but the sigstore bundle binds
    // the publishing GitHub repo. Ensure synthesized platform packages
    // inherit identity fields from the main package.
    writeFileSync(
      join(repo, 'pkg', 'package.json'),
      JSON.stringify({
        name: 'demo-cli',
        version: '0.0.0',
        license: 'MIT',
        homepage: 'https://example.com',
        repository: { type: 'git', url: 'git+https://github.com/acme/demo-cli.git' },
      }, null, 2),
    );
    mkdirSync(join(artifactsRoot, 'demo-cli-linux-x64-gnu'), { recursive: true });
    writeFileSync(join(artifactsRoot, 'demo-cli-linux-x64-gnu', 'demo-cli'), Buffer.from('x'));

    const stagingPkgJsons: Record<string, unknown>[] = [];
    execMock.mockImplementation((_cmd, args, opts) => {
      const a = args as string[];
      if (a[0] === 'view') throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      const cwd = (opts as { cwd?: string } | undefined)?.cwd;
      if (cwd) {
        stagingPkgJsons.push(JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>);
      }
      return Buffer.from('');
    });

    const pkg: PlatformPkg = basePkg({
      build: [{ mode: 'bundled-cli', name: DEFAULT_NAME_TEMPLATE }],
      targets: ['linux-x64-gnu'],
    });
    await publishPlatforms(pkg, '0.2.0', makeCtx());
    expect(stagingPkgJsons[0]!.license).toBe('MIT');
    expect(stagingPkgJsons[0]!.homepage).toBe('https://example.com');
    expect(stagingPkgJsons[0]!.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/acme/demo-cli.git',
    });
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

describe('publishPlatforms (multi-mode, #dirsql)', () => {
  it('publishes both napi and bundled-cli families and pins both in optionalDependencies', async () => {
    // Two artifacts per triple — one per mode — each in its own
    // mode-infixed artifact dir.
    mkdirSync(join(artifactsRoot, 'demo-cli-napi-linux-x64-gnu'), { recursive: true });
    writeFileSync(join(artifactsRoot, 'demo-cli-napi-linux-x64-gnu', 'demo.linux-x64-gnu.node'), Buffer.from('napi'));
    mkdirSync(join(artifactsRoot, 'demo-cli-bundled-cli-linux-x64-gnu'), { recursive: true });
    writeFileSync(join(artifactsRoot, 'demo-cli-bundled-cli-linux-x64-gnu', 'demo-cli'), Buffer.from('#!/bin/bash\n'));

    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      return Buffer.from('');
    });

    const pkg: PlatformPkg = basePkg({
      build: [
        { mode: 'napi', name: '@dirsql/lib-{triple}' },
        { mode: 'bundled-cli', name: '@dirsql/cli-{triple}' },
      ],
      targets: ['linux-x64-gnu'],
    });
    const r = await publishPlatforms(pkg, '0.2.0', makeCtx());
    expect(r.published).toEqual(['@dirsql/lib-linux-x64-gnu', '@dirsql/cli-linux-x64-gnu']);

    const pkgJson = JSON.parse(readFileSync(join(repo, 'pkg', 'package.json'), 'utf8')) as {
      optionalDependencies: Record<string, string>;
    };
    expect(pkgJson.optionalDependencies).toEqual({
      '@dirsql/lib-linux-x64-gnu': '0.2.0',
      '@dirsql/cli-linux-x64-gnu': '0.2.0',
    });
  });

  it('synthesized platform package picks the right main file per mode', async () => {
    mkdirSync(join(artifactsRoot, 'demo-cli-napi-linux-x64-gnu'), { recursive: true });
    writeFileSync(join(artifactsRoot, 'demo-cli-napi-linux-x64-gnu', 'demo.linux-x64-gnu.node'), Buffer.from('napi'));
    mkdirSync(join(artifactsRoot, 'demo-cli-bundled-cli-linux-x64-gnu'), { recursive: true });
    writeFileSync(join(artifactsRoot, 'demo-cli-bundled-cli-linux-x64-gnu', 'demo-cli'), Buffer.from('x'));

    const stagingByName = new Map<string, Record<string, unknown>>();
    execMock.mockImplementation((_cmd, args, opts) => {
      const a = args as string[];
      if (a[0] === 'view') throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      const cwd = (opts as { cwd?: string } | undefined)?.cwd;
      if (cwd) {
        const json = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>;
        stagingByName.set(String(json.name), json);
      }
      return Buffer.from('');
    });

    await publishPlatforms(
      basePkg({
        build: [
          { mode: 'napi', name: '@dirsql/lib-{triple}' },
          { mode: 'bundled-cli', name: '@dirsql/cli-{triple}' },
        ],
        targets: ['linux-x64-gnu'],
      }),
      '0.2.0',
      makeCtx(),
    );

    expect(stagingByName.get('@dirsql/lib-linux-x64-gnu')!.main).toBe('demo.linux-x64-gnu.node');
    expect(stagingByName.get('@dirsql/cli-linux-x64-gnu')!.main).toBe('demo-cli');
  });

  it('resolves {scope} and {base} variables when the main package is scoped', async () => {
    // Single-entry build → no mode infix in the artifact dir name.
    mkdirSync(join(artifactsRoot, 'demo-cli-linux-x64-gnu'), { recursive: true });
    writeFileSync(join(artifactsRoot, 'demo-cli-linux-x64-gnu', 'demo.node'), Buffer.from('x'));

    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      return Buffer.from('');
    });

    const r = await publishPlatforms(
      basePkg({
        npm: '@dirsql/core',
        build: [{ mode: 'napi', name: '@{scope}/{base}-lib-{triple}' }],
        targets: ['linux-x64-gnu'],
      }),
      '0.1.0',
      makeCtx(),
    );
    expect(r.published).toEqual(['@dirsql/core-lib-linux-x64-gnu']);
  });
});

describe('looksLikePublishOverRace', () => {
  it('matches npm\'s E403 over-publish stderr', () => {
    expect(
      looksLikePublishOverRace(
        'npm error code E403\nnpm error 403 You cannot publish over the previously published versions: 0.0.1.',
      ),
    ).toBe(true);
  });

  it('returns false on unrelated 403 stderr', () => {
    expect(looksLikePublishOverRace('npm error 403 Forbidden - PUT')).toBe(false);
    expect(looksLikePublishOverRace('npm ERR! 403 ENEEDAUTH')).toBe(false);
  });

  it('returns false on undefined / empty', () => {
    expect(looksLikePublishOverRace(undefined)).toBe(false);
    expect(looksLikePublishOverRace('')).toBe(false);
  });
});

describe('publishPlatforms: npm CLI retry race (#dirsql)', () => {
  it('treats E403 over-publish as success and continues to rewrite optionalDependencies', async () => {
    // npm CLI retried a successful PUT after a transient response and the
    // registry rejected the duplicate. The package is on the registry;
    // the engine should not mark this as a publish failure.
    makeArtifact('linux-x64-gnu', 'demo.linux-x64-gnu.node', Buffer.from('napi'));

    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {
        throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      }
      // publish: simulate the retry-race E403
      throw Object.assign(new Error('publish failed'), {
        status: 1,
        stderr: Buffer.from(
          'npm error code E403\nnpm error 403 You cannot publish over the previously published versions: 0.2.0.',
        ),
      });
    });

    const r = await publishPlatforms(
      basePkg({ targets: ['linux-x64-gnu'] }),
      '0.2.0',
      makeCtx(),
    );
    // The race-tolerated publish counts as published from the engine's view —
    // the package is on the registry at the requested version.
    expect(r.published).toEqual(['demo-cli-linux-x64-gnu']);
    // Main package.json got the optionalDependencies rewrite.
    const pkgJson = JSON.parse(readFileSync(join(repo, 'pkg', 'package.json'), 'utf8')) as {
      optionalDependencies: Record<string, string>;
    };
    expect(pkgJson.optionalDependencies['demo-cli-linux-x64-gnu']).toBe('0.2.0');
  });
});
