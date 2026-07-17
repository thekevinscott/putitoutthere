/**
 * npm platform-package orchestration tests.
 *
 * Mocks the process seam (`execCapture`) so we can assert every npm
 * invocation (platform publishes, then main) and stub per-package
 * `isPublished` lookups.
 *
 * Unit-suite isolation: the subprocess boundary (the process seam,
 * `execCapture`) and the filesystem (`node:fs/promises`) are both mocked.
 * `node:fs/promises` is backed by a small in-memory tree (below) shared
 * between test setup and the unit under test, so synthesized staging dirs,
 * artifact reads, and package.json rewrites all observe the same state
 * without a real temp tree. Real end-to-end file behavior is covered by
 * the npm integration tier (tests/integration/npm.integration.test.ts).
 *
 * Issue #19. Plan: §13.7.
 */

import { chmod, cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture, type ExecResult } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';

vi.mock('../utils/exec-error.js', async () => await vi.importActual<typeof import('../utils/exec-error.js')>('../utils/exec-error.js'));
import {
  assertTripleSupported,
  DEFAULT_NAME_TEMPLATE,
  looksLikePublishOverRace,
  looksLikeTlogDuplicate,
  normalizeBuild,
  pickMainFile,
  platformArtifactName,
  publishPlatforms,
  resolvePlatformName,
  targetToOsCpu,
  toRustTriple,
  type PlatformPkg,
} from './npm-platform.js';
import type { Ctx } from '../types.js';

vi.mock('../utils/exec-capture.js');
vi.mock('node:fs/promises');

const execMock = vi.mocked(execCapture);

/** A resolved `execCapture` result carrying `stdout`. */
function ok(stdout: string): ExecResult {
  return { stdout, stderr: '' };
}

/* -------------------------- in-memory filesystem -------------------------- */
// A minimal `node:fs/promises` substitute keyed by normalized (forward-slash)
// path, so the source's real-`node:path` joins (back-slashed on Windows)
// resolve to the same entries the test seeds. Covers exactly the calls
// crossing the mocked boundary: write/read/readdir/chmod/cp/mkdtemp/rm. The
// `*Sync` names below are module-local store helpers used to seed the tree
// and assert on it in test bodies — they are not the source's I/O.

type FsFile = { type: 'file'; content: Buffer; mode: number };
type FsDir = { type: 'dir'; mode: number };
type FsNode = FsFile | FsDir;

let store = new Map<string, FsNode>();
let mkdtempCounter = 0;

function norm(p: unknown): string {
  let s = String(p).replace(/\\/g, '/').replace(/\/+/g, '/');
  if (s.length > 1 && s.endsWith('/')) {s = s.slice(0, -1);}
  return s;
}
function parentOf(np: string): string {
  const i = np.lastIndexOf('/');
  return i <= 0 ? '/' : np.slice(0, i);
}
function ensureDir(p: string): void {
  const np = norm(p);
  if (store.has(np)) {return;}
  if (np !== '/') {ensureDir(parentOf(np));}
  store.set(np, { type: 'dir', mode: 0o755 });
}
function enoent(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' });
}

function resetFs(): void {
  store = new Map<string, FsNode>();
  store.set('/', { type: 'dir', mode: 0o755 });
}

/* --------- sync store helpers for test-body seeding + assertions --------- */
function mkdirSync(p: string, _opts?: unknown): void {
  ensureDir(norm(p));
}
function writeFileSync(p: string, data: string | Buffer, _enc?: unknown): void {
  const np = norm(p);
  ensureDir(parentOf(np));
  const content = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(String(data));
  store.set(np, { type: 'file', content, mode: 0o644 });
}
function readFileSync(p: string, enc: BufferEncoding): string;
function readFileSync(p: string, enc?: unknown): string | Buffer;
function readFileSync(p: string, enc?: unknown): string | Buffer {
  const np = norm(p);
  const node = store.get(np);
  if (!node || node.type !== 'file') {throw enoent(np);}
  const encoding = typeof enc === 'string' ? enc : (enc as { encoding?: string } | undefined)?.encoding;
  return encoding ? node.content.toString(encoding as BufferEncoding) : Buffer.from(node.content);
}
function readdirStore(np: string): string[] {
  const prefix = np === '/' ? '/' : `${np}/`;
  const names: string[] = [];
  for (const key of store.keys()) {
    if (key === np) {continue;}
    if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
      names.push(key.slice(prefix.length));
    }
  }
  return names;
}
function existsSync(p: string): boolean {
  return store.has(norm(p));
}
function chmodSync(p: string, mode: number): void {
  const np = norm(p);
  const node = store.get(np);
  if (!node) {throw enoent(np);}
  node.mode = mode;
}
function statSync(p: string): { mode: number } {
  const np = norm(p);
  const node = store.get(np);
  if (!node) {throw enoent(np);}
  return { mode: node.mode };
}

function installFs(): void {
  vi.mocked(writeFile).mockImplementation(((p: string, data: string | Buffer) => {
    writeFileSync(p, data);
    return Promise.resolve();
  }) as typeof writeFile);

  vi.mocked(readFile).mockImplementation(((p: string, enc?: unknown) => {
    try {
      return Promise.resolve(readFileSync(p, enc));
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }) as typeof readFile);

  vi.mocked(readdir).mockImplementation(((p: string) => {
    const np = norm(p);
    const node = store.get(np);
    if (!node || node.type !== 'dir') {return Promise.reject(enoent(np));}
    return Promise.resolve(readdirStore(np));
  }) as unknown as typeof readdir);

  vi.mocked(chmod).mockImplementation(((p: string, mode: number) => {
    const np = norm(p);
    const node = store.get(np);
    if (!node) {return Promise.reject(enoent(np));}
    node.mode = typeof mode === 'string' ? parseInt(mode, 8) : mode;
    return Promise.resolve();
  }) as typeof chmod);

  vi.mocked(cp).mockImplementation(((src: string, dest: string) => {
    const from = norm(src);
    const to = norm(dest);
    const node = store.get(from);
    if (!node) {return Promise.reject(enoent(from));}
    if (node.type === 'file') {
      ensureDir(parentOf(to));
      store.set(to, { type: 'file', content: Buffer.from(node.content), mode: node.mode });
      return Promise.resolve();
    }
    ensureDir(to);
    const prefix = `${from}/`;
    for (const [key, child] of [...store.entries()]) {
      if (key.startsWith(prefix)) {
        const rel = key.slice(prefix.length);
        const target = `${to}/${rel}`;
        store.set(
          target,
          child.type === 'file'
            ? { type: 'file', content: Buffer.from(child.content), mode: child.mode }
            : { type: 'dir', mode: child.mode },
        );
      }
    }
    return Promise.resolve();
  }) as typeof cp);

  vi.mocked(mkdtemp).mockImplementation((prefix: string) => {
    mkdtempCounter += 1;
    const dir = `${norm(prefix)}${mkdtempCounter.toString().padStart(6, '0')}`;
    ensureDir(dir);
    return Promise.resolve(dir);
  });

  vi.mocked(rm).mockImplementation(((p: string) => {
    const np = norm(p);
    store.delete(np);
    const prefix = `${np}/`;
    for (const key of [...store.keys()]) {
      if (key.startsWith(prefix)) {store.delete(key);}
    }
    return Promise.resolve();
  }) as typeof rm);
}

installFs();

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
  const dir = `${artifactsRoot}/demo-cli-${target}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${fileName}`, contents);
}

function basePkg(over: Partial<PlatformPkg> = {}): PlatformPkg {
  return {
    name: 'demo-cli',
    path: `${repo}/pkg`,
    build: [{ mode: 'napi', name: DEFAULT_NAME_TEMPLATE }],
    targets: ['linux-x64-gnu', 'darwin-arm64'],
    ...over,
  };
}

// #305: `npm publish` for platform packages receives the synthesized
// staging directory as a positional `<folder>` arg (last non-flag arg
// in `args`). Helper extracts it so tests can inspect the staged
// package.json without depending on `cwd` (which now points at the
// consumer's pkg.path so npm honors the local .npmrc).
function stagingDirArg(args: string[]): string | undefined {
  if (args[0] !== 'publish') {return undefined;}
  // Skip args[0]='publish'; folder is the lone trailing non-flag arg.
  for (let i = args.length - 1; i >= 1; i -= 1) {
    const a = args[i]!;
    if (!a.startsWith('-')) {return a;}
  }
  return undefined;
}

beforeEach(() => {
  execMock.mockReset();
  resetFs();
  repo = '/repo';
  artifactsRoot = `${repo}/artifacts`;
  mkdirSync(artifactsRoot, { recursive: true });
  mkdirSync(`${repo}/pkg`, { recursive: true });
  writeFileSync(
    `${repo}/pkg/package.json`,
    JSON.stringify({ name: 'demo-cli', version: '0.0.0' }, null, 2),
  );
});

afterEach(() => {
  resetFs();
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

describe('assertTripleSupported (#170)', () => {
  it('does not throw for a triple that is mapped in TRIPLE_MAP', () => {
    expect(() => assertTripleSupported('linux-x64-gnu', 'demo-cli')).not.toThrow();
  });

  it('is case-insensitive, mirroring targetToOsCpu', () => {
    expect(() => assertTripleSupported('LINUX-X64-GNU', 'demo-cli')).not.toThrow();
  });

  it('throws naming the offending package and TRIPLE_MAP for an unmapped triple', () => {
    expect(() => assertTripleSupported('riscv64-unknown-linux-gnu', 'demo-cli')).toThrow(
      /demo-cli.*riscv64-unknown-linux-gnu.*TRIPLE_MAP.*src\/handlers\/npm-platform\.ts/,
    );
  });
});

describe('toRustTriple (#387)', () => {
  // Every napi-rs short form maps to its Rust triple. These are the
  // triples `rustup target add` / `cargo build --target` consume in the
  // npm bundled-cli cross-compile; the npm-flavor form they reject.
  it.each([
    ['linux-x64-gnu', 'x86_64-unknown-linux-gnu'],
    ['linux-x64-musl', 'x86_64-unknown-linux-musl'],
    ['linux-arm64-gnu', 'aarch64-unknown-linux-gnu'],
    ['linux-arm64-musl', 'aarch64-unknown-linux-musl'],
    ['linux-arm-gnueabihf', 'armv7-unknown-linux-gnueabihf'],
    ['linux-arm-musleabihf', 'armv7-unknown-linux-musleabihf'],
    ['darwin-x64', 'x86_64-apple-darwin'],
    ['darwin-arm64', 'aarch64-apple-darwin'],
    ['win32-x64-msvc', 'x86_64-pc-windows-msvc'],
    ['win32-arm64-msvc', 'aarch64-pc-windows-msvc'],
  ])('maps napi triple %s → rust triple %s', (napi, rust) => {
    expect(toRustTriple(napi)).toBe(rust);
  });

  it('covers every napi key TRIPLE_MAP accepts (no plan-time drift)', () => {
    // assertTripleSupported gates on TRIPLE_MAP, then plan calls
    // toRustTriple — so every napi triple a consumer can legally declare
    // must resolve here. A new TRIPLE_MAP napi entry without a NAPI_TO_RUST
    // entry would throw mid-plan; this pins the two maps together.
    const napiKeys = [
      'linux-x64-gnu',
      'linux-x64-musl',
      'linux-arm64-gnu',
      'linux-arm64-musl',
      'linux-arm-gnueabihf',
      'linux-arm-musleabihf',
      'darwin-x64',
      'darwin-arm64',
      'win32-x64-msvc',
      'win32-arm64-msvc',
    ];
    for (const t of napiKeys) {
      expect(() => toRustTriple(t)).not.toThrow();
    }
  });

  it('passes a Rust triple through unchanged (identity)', () => {
    expect(toRustTriple('x86_64-unknown-linux-gnu')).toBe('x86_64-unknown-linux-gnu');
    expect(toRustTriple('aarch64-apple-darwin')).toBe('aarch64-apple-darwin');
  });

  it('is case-insensitive, mirroring targetToOsCpu', () => {
    expect(toRustTriple('LINUX-X64-GNU')).toBe('x86_64-unknown-linux-gnu');
  });

  it('throws a descriptive error for unmappable triples', () => {
    expect(() => toRustTriple('mips64-unknown-linux-gnu')).toThrow(
      /mips64-unknown-linux-gnu.*NAPI_TO_RUST.*src\/handlers\/npm-platform\.ts/,
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
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      return Promise.resolve(ok(''));
    });

    const r = await publishPlatforms(basePkg(), '0.2.0', makeCtx());
    expect(r.published).toEqual(['demo-cli-linux-x64-gnu', 'demo-cli-darwin-arm64']);

    const pkgJson = JSON.parse(readFileSync(`${repo}/pkg/package.json`, 'utf8')) as {
      optionalDependencies: Record<string, string>;
    };
    expect(pkgJson.optionalDependencies).toEqual({
      'demo-cli-linux-x64-gnu': '0.2.0',
      'demo-cli-darwin-arm64': '0.2.0',
    });

    // Exact subprocess/fs contract of the synthesize→publish→cleanup path:
    // the published-probe queries the exact platform coordinate, scoped to cwd,
    expect(execMock).toHaveBeenCalledWith(
      'npm',
      ['view', 'demo-cli-linux-x64-gnu@0.2.0', 'version'],
      { cwd: '/repo' },
    );
    // the staging tempdir uses the engine's prefix,
    expect(vi.mocked(mkdtemp)).toHaveBeenCalledWith(expect.stringContaining('putitoutthere-plat-'));
    // artifact files are copied recursively into staging,
    expect(vi.mocked(cp)).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      recursive: true,
    });
    // the FIRST fs read is the main package.json, as utf8 text (synthesize
    // inherits repository/license); pin that specific call's encoding.
    expect(vi.mocked(readFile).mock.calls[0]).toEqual([
      expect.stringContaining('package.json'),
      'utf8',
    ]);
    // the platform tarball is published via `npm publish`,
    expect(execMock).toHaveBeenCalledWith('npm', expect.arrayContaining(['publish']), expect.anything());
    // the staging dir is force-removed recursively afterwards,
    expect(vi.mocked(rm)).toHaveBeenCalledWith(expect.anything(), { recursive: true, force: true });
    // and the LAST fs write is the rewritten main package.json, as utf8 text.
    const writeCalls = vi.mocked(writeFile).mock.calls;
    expect(writeCalls[writeCalls.length - 1]).toEqual([
      expect.stringContaining('package.json'),
      expect.any(String),
      'utf8',
    ]);
  });

  it('skips platform packages that are already published', async () => {
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view' && String(a[1]).includes('linux-x64-gnu')) {return Promise.resolve(ok('0.2.0\n'));}
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      return Promise.resolve(ok(''));
    });

    const r = await publishPlatforms(basePkg(), '0.2.0', makeCtx());
    expect(r.skipped).toContain('demo-cli-linux-x64-gnu');
    expect(r.published).toEqual(['demo-cli-darwin-arm64']);
    // Already-published platforms still end up in optionalDependencies.
    const pkgJson = JSON.parse(readFileSync(`${repo}/pkg/package.json`, 'utf8')) as {
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
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      if (a[0] === 'publish') {return Promise.reject(new ExecError('boom', '', 'registry error', 1));}
      return Promise.resolve(ok(''));
    });

    await expect(publishPlatforms(basePkg(), '0.2.0', makeCtx())).rejects.toThrow(/platform/);

    // Main package.json must NOT have optionalDependencies.
    const pkgJson = JSON.parse(readFileSync(`${repo}/pkg/package.json`, 'utf8')) as Record<string, unknown>;
    expect(pkgJson.optionalDependencies).toBeUndefined();
    expect(calls).toBeGreaterThan(0);
  });

});

describe('publishPlatforms (bundled-cli)', () => {
  it('synthesized platform package.json picks the executable as main', async () => {
    mkdirSync(`${artifactsRoot}/demo-cli-linux-x64-gnu`, { recursive: true });
    writeFileSync(`${artifactsRoot}/demo-cli-linux-x64-gnu/demo-cli`, Buffer.from('#!/bin/bash\n'));

    const stagingPkgJsons: Record<string, unknown>[] = [];
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      // #305: `npm publish <folder>` — staging dir is the last positional
      // arg; cwd is the consumer's pkg.path (so npm finds the consumer's
      // .npmrc for auth). Inspect package.json by parsing the folder arg.
      const folder = stagingDirArg(a);
      if (folder) {
        stagingPkgJsons.push(JSON.parse(readFileSync(`${folder}/package.json`, 'utf8')) as Record<string, unknown>);
      }
      return Promise.resolve(ok(''));
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
      `${repo}/pkg/package.json`,
      JSON.stringify({
        name: 'demo-cli',
        version: '0.0.0',
        license: 'MIT',
        homepage: 'https://example.com',
        repository: { type: 'git', url: 'git+https://github.com/acme/demo-cli.git' },
      }, null, 2),
    );
    mkdirSync(`${artifactsRoot}/demo-cli-linux-x64-gnu`, { recursive: true });
    writeFileSync(`${artifactsRoot}/demo-cli-linux-x64-gnu/demo-cli`, Buffer.from('x'));

    const stagingPkgJsons: Record<string, unknown>[] = [];
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      const folder = stagingDirArg(a);
      if (folder) {
        stagingPkgJsons.push(JSON.parse(readFileSync(`${folder}/package.json`, 'utf8')) as Record<string, unknown>);
      }
      return Promise.resolve(ok(''));
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

  // Skipped on Windows: NTFS does not carry POSIX execute bits, so
  // `statSync().mode & 0o111` is always 0 there and the +x the fix sets
  // is unobservable. npm platform publish runs on Linux runners; the
  // ubuntu/macos unit legs exercise the behavior.
  it.skipIf(process.platform === 'win32')('staged bundled-cli binary is executable even when the artifact lost its mode bits', async () => {
    // The GitHub Actions artifact upload/download boundary strips the
    // executable bit, so the cross-compiled binary arrives at the publish
    // job as 0644. The synthesized platform package must restore +x —
    // npm only chmods `bin` entries, and the bundled binary is referenced
    // via `main`, so without this the launcher's spawnSync EACCESes.
    mkdirSync(`${artifactsRoot}/demo-cli-linux-x64-gnu`, { recursive: true });
    const artifactBin = `${artifactsRoot}/demo-cli-linux-x64-gnu/demo-cli`;
    writeFileSync(artifactBin, Buffer.from('#!/bin/sh\n'));
    chmodSync(artifactBin, 0o644); // simulate the lost executable bit

    const stagedModes: number[] = [];
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      const folder = stagingDirArg(a);
      if (folder) {
        stagedModes.push(statSync(`${folder}/demo-cli`).mode);
      }
      return Promise.resolve(ok(''));
    });

    const pkg: PlatformPkg = basePkg({
      build: [{ mode: 'bundled-cli', name: DEFAULT_NAME_TEMPLATE }],
      targets: ['linux-x64-gnu'],
    });
    await publishPlatforms(pkg, '0.2.0', makeCtx());

    expect(stagedModes).toHaveLength(1);
    // At least one execute bit must be set on the staged binary.
    expect(stagedModes[0]! & 0o111).not.toBe(0);
  });
});

// #305: regression for the platform publish auth-lookup bug. Earlier
// versions ran `npm publish` with `cwd: stagingDir` and no folder arg —
// npm reads `.npmrc` from cwd upward, so the consumer's local `.npmrc`
// (which the e2e workflow writes alongside the fixture to authenticate
// against Verdaccio, and the analogue real consumers write for the
// NPM_TOKEN-bootstrap shape) was never seen, and the platform PUTs went
// out unauthenticated. The fix runs `npm publish <stagingDir>` with
// `cwd: pkg.path` so npm finds the same `.npmrc` the main-package
// publish (npm.ts:publishImpl) honors.
describe('publishPlatforms — cwd is pkg.path so npm finds the consumer .npmrc (#305)', () => {
  it('runs `npm publish <stagingDir>` from cwd=pkg.path', async () => {
    makeArtifact('linux-x64-gnu', 'demo.linux-x64-gnu.node', Buffer.from('x'));
    const publishCalls: {
      cwd: string | undefined;
      folder: string | undefined;
      folderExisted: boolean;
      folderHadPackageJson: boolean;
    }[] = [];
    execMock.mockImplementation((_cmd, args, opts) => {
      const a = args as string[];
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      if (a[0] === 'publish') {
        // Capture staging-dir state at call time — `publishPlatforms` cleans
        // up the tempdir in a `finally` after each publish, so post-hoc
        // existsSync would always fail regardless of correctness.
        const folder = stagingDirArg(a);
        publishCalls.push({
          cwd: (opts as { cwd?: string } | undefined)?.cwd,
          folder,
          folderExisted: folder !== undefined && existsSync(folder),
          folderHadPackageJson:
            folder !== undefined && existsSync(`${folder}/package.json`),
        });
      }
      return Promise.resolve(ok(''));
    });

    const pkg: PlatformPkg = basePkg({ targets: ['linux-x64-gnu'] });
    await publishPlatforms(pkg, '0.2.0', makeCtx());

    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]!.cwd).toBe(pkg.path);
    expect(publishCalls[0]!.folder).toBeDefined();
    expect(publishCalls[0]!.folderExisted).toBe(true);
    expect(publishCalls[0]!.folderHadPackageJson).toBe(true);
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
        return Promise.reject(new ExecError('E404', '', '404', 1));
      }
      return Promise.resolve(ok(''));
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
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      return Promise.resolve(ok(''));
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
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      return Promise.resolve(ok(''));
    });
    await publishPlatforms(
      basePkg({ targets: ['linux-x64-gnu'] }),
      '0.1.0',
      makeCtx({ env: { ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'y' } }),
    );
    const publishCall = calls.find((c) => c[0] === 'publish');
    expect(publishCall).toContain('--provenance');
  });

  it('forwards --registry and suppresses --provenance when PIOT_NPM_REGISTRY is set (#304)', async () => {
    makeArtifact('linux-x64-gnu', 'demo.node', Buffer.from('x'));
    const calls: string[][] = [];
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      calls.push(a);
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      return Promise.resolve(ok(''));
    });
    await publishPlatforms(
      basePkg({ targets: ['linux-x64-gnu'] }),
      '0.1.0',
      makeCtx({
        env: {
          PIOT_NPM_REGISTRY: 'http://verdaccio:4873',
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-present',
        },
      }),
    );
    const publishCall = calls.find((c) => c[0] === 'publish');
    expect(publishCall).toContain('--registry=http://verdaccio:4873');
    expect(publishCall).not.toContain('--provenance');
  });

  it('merges onto existing optionalDependencies rather than replacing', async () => {
    makeArtifact('linux-x64-gnu', 'demo.node', Buffer.from('x'));
    writeFileSync(
      `${repo}/pkg/package.json`,
      JSON.stringify({ name: 'demo-cli', version: '0.0.0', optionalDependencies: { 'other-dep': '^1.0.0' } }, null, 2),
    );
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      return Promise.resolve(ok(''));
    });
    await publishPlatforms(basePkg({ targets: ['linux-x64-gnu'] }), '0.2.0', makeCtx());
    const pkgJson = JSON.parse(readFileSync(`${repo}/pkg/package.json`, 'utf8')) as {
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
    expect(existsSync(`${repo}/artifacts/demo-cli-linux-x64-gnu`)).toBe(true);
  });

  // #237: slash-containing pkg.name (polyglot-monorepo grouping shape)
  // resolves to the encoded artifact directory the planner emitted.
  it('encodes `/` in pkg.name when looking up the artifact directory', async () => {
    // On-disk dir uses the encoded name; the lookup must match it.
    const dir = `${artifactsRoot}/js__cachetta-linux-x64-gnu`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/cachetta.linux-x64-gnu.node`, Buffer.from('napi-bytes'));
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      return Promise.resolve(ok(''));
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
    mkdirSync(`${artifactsRoot}/demo-cli-napi-linux-x64-gnu`, { recursive: true });
    writeFileSync(`${artifactsRoot}/demo-cli-napi-linux-x64-gnu/demo.linux-x64-gnu.node`, Buffer.from('napi'));
    mkdirSync(`${artifactsRoot}/demo-cli-bundled-cli-linux-x64-gnu`, { recursive: true });
    writeFileSync(`${artifactsRoot}/demo-cli-bundled-cli-linux-x64-gnu/demo-cli`, Buffer.from('#!/bin/bash\n'));

    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      return Promise.resolve(ok(''));
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

    const pkgJson = JSON.parse(readFileSync(`${repo}/pkg/package.json`, 'utf8')) as {
      optionalDependencies: Record<string, string>;
    };
    expect(pkgJson.optionalDependencies).toEqual({
      '@dirsql/lib-linux-x64-gnu': '0.2.0',
      '@dirsql/cli-linux-x64-gnu': '0.2.0',
    });
  });

  it('synthesized platform package picks the right main file per mode', async () => {
    mkdirSync(`${artifactsRoot}/demo-cli-napi-linux-x64-gnu`, { recursive: true });
    writeFileSync(`${artifactsRoot}/demo-cli-napi-linux-x64-gnu/demo.linux-x64-gnu.node`, Buffer.from('napi'));
    mkdirSync(`${artifactsRoot}/demo-cli-bundled-cli-linux-x64-gnu`, { recursive: true });
    writeFileSync(`${artifactsRoot}/demo-cli-bundled-cli-linux-x64-gnu/demo-cli`, Buffer.from('x'));

    const stagingByName = new Map<string, Record<string, unknown>>();
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      const folder = stagingDirArg(a);
      if (folder) {
        const json = JSON.parse(readFileSync(`${folder}/package.json`, 'utf8')) as Record<string, unknown>;
        stagingByName.set(String(json.name), json);
      }
      return Promise.resolve(ok(''));
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
    mkdirSync(`${artifactsRoot}/demo-cli-linux-x64-gnu`, { recursive: true });
    writeFileSync(`${artifactsRoot}/demo-cli-linux-x64-gnu/demo.node`, Buffer.from('x'));

    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      return Promise.resolve(ok(''));
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

describe('pickMainFile', () => {
  it('napi: picks the .node file when present', () => {
    expect(pickMainFile(['README.md', 'demo.linux-x64-gnu.node'], 'napi')).toBe(
      'demo.linux-x64-gnu.node',
    );
  });

  it('napi: falls back to the first file when no .node is present', () => {
    // Defensive fallback for a napi artifact missing its .node payload.
    expect(pickMainFile(['only-file.txt'], 'napi')).toBe('only-file.txt');
  });

  it('bundled-cli: picks the first non-package.json file', () => {
    expect(pickMainFile(['package.json', 'demo-cli'], 'bundled-cli')).toBe('demo-cli');
  });

  it('bundled-cli: falls back to the first file when only package.json is present', () => {
    // Defensive fallback for a bundled-cli artifact with no payload file.
    expect(pickMainFile(['package.json'], 'bundled-cli')).toBe('package.json');
  });
});

describe('artifact path resolution: artifactsRoot unset', () => {
  it('resolves the artifact dir under ctx.cwd/artifacts when artifactsRoot is undefined', async () => {
    // Exercises the `ctx.artifactsRoot ?? join(ctx.cwd, "artifacts")` fallback:
    // the default artifacts tree lives at `${repo}/artifacts`, which is exactly
    // `join(cwd, "artifacts")`.
    makeArtifact('linux-x64-gnu', 'demo.linux-x64-gnu.node', Buffer.from('napi'));
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      return Promise.resolve(ok(''));
    });
    // artifactsRoot absent (not undefined-valued) so the source's
    // `ctx.artifactsRoot ?? join(ctx.cwd, 'artifacts')` fallback fires.
    const ctx = makeCtx();
    delete (ctx as { artifactsRoot?: string }).artifactsRoot;
    const r = await publishPlatforms(
      basePkg({ targets: ['linux-x64-gnu'] }),
      '0.2.0',
      ctx,
    );
    expect(r.published).toEqual(['demo-cli-linux-x64-gnu']);
  });
});

describe('publishPlatforms: generic platform publish failure', () => {
  it('reports the failure via String(err) when npm throws a non-Error with no stderr', async () => {
    // Neither the publish-over race nor the tlog-dedupe shape matches, and
    // the thrown value is a bare string (no `.stderr`, not an Error). The
    // generic message must fall back to String(err) and omit the stderr
    // block.
    makeArtifact('linux-x64-gnu', 'demo.linux-x64-gnu.node', Buffer.from('napi'));
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {
        throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      }
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error to hit the String(err) branch
      throw 'catastrophic npm failure';
    });

    await expect(
      publishPlatforms(basePkg({ targets: ['linux-x64-gnu'] }), '0.2.0', makeCtx()),
    ).rejects.toThrow(/npm publish \(platform\) failed: catastrophic npm failure/);

    // Failed before the rewrite: main package.json must NOT carry optionalDependencies.
    const pkgJson = JSON.parse(readFileSync(`${repo}/pkg/package.json`, 'utf8')) as Record<string, unknown>;
    expect(pkgJson.optionalDependencies).toBeUndefined();
  });

  it('trims surrounding whitespace from npm stderr in the generic failure message (#469)', async () => {
    // A publish failure that matches neither the over-publish nor the tlog
    // race interpolates npm's stderr into the thrown message — trimmed, not raw.
    makeArtifact('linux-x64-gnu', 'demo.linux-x64-gnu.node', Buffer.from('napi'));
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      return Promise.reject(new ExecError('boom', '', '\n  npm ERR! nope  \n', 1));
    });
    const err = await publishPlatforms(
      basePkg({ targets: ['linux-x64-gnu'] }),
      '0.2.0',
      makeCtx(),
    ).catch((e: unknown) => e as Error) as Error;
    expect(err.message).toBe('npm publish (platform) failed:\nnpm ERR! nope');
  });
});

describe('publishPlatforms: staging cleanup is best-effort (#581)', () => {
  it('reports the platform as published and warns when cleanup rm rejects after a successful publish', async () => {
    // Per the all-or-nothing-per-package commitment, a publish that
    // succeeded must not be masked by a post-publish cleanup failure.
    // `rm` on the staging tempdir can reject (EBUSY/EPERM on Windows
    // runners even with force:true); the row should still report
    // published and the failure should be swallowed with a warning.
    makeArtifact('linux-x64-gnu', 'demo.linux-x64-gnu.node', Buffer.from('napi'));
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {return Promise.reject(new ExecError('E404', '', '404', 1));}
      return Promise.resolve(ok('')); // publish succeeds
    });
    // The cleanup rejects AFTER the publish already succeeded.
    const cleanupErr = Object.assign(new Error('EBUSY: resource busy or locked, rmdir'), {
      code: 'EBUSY',
    });
    vi.mocked(rm).mockRejectedValueOnce(cleanupErr);
    const warn = vi.fn<Ctx['log']['warn']>();
    const ctx = makeCtx({
      log: { debug: () => {}, info: () => {}, warn, error: () => {} },
    });

    const r = await publishPlatforms(basePkg({ targets: ['linux-x64-gnu'] }), '0.2.0', ctx);

    // The successful publish is not masked by the cleanup rejection.
    expect(r.published).toEqual(['demo-cli-linux-x64-gnu']);
    // A warning is emitted about the swallowed cleanup failure: it names
    // the staging directory it could not remove and forwards the caught
    // error as a structured field so the operator can see the cause.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toEqual([
      expect.stringMatching(/failed to clean up .*staging directory/i),
      { error: cleanupErr },
    ]);
    // The main package.json still received the optionalDependencies rewrite.
    const pkgJson = JSON.parse(readFileSync(`${repo}/pkg/package.json`, 'utf8')) as {
      optionalDependencies: Record<string, string>;
    };
    expect(pkgJson.optionalDependencies['demo-cli-linux-x64-gnu']).toBe('0.2.0');
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

describe('looksLikeTlogDuplicate', () => {
  it('matches npm\'s TLOG_CREATE_ENTRY_ERROR code', () => {
    expect(
      looksLikeTlogDuplicate(
        'npm error code TLOG_CREATE_ENTRY_ERROR\nnpm error error creating tlog entry - (409) ...',
      ),
    ).toBe(true);
  });

  it('matches the Rekor "equivalent entry already exists" prose even without the code', () => {
    expect(
      looksLikeTlogDuplicate(
        'npm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log with UUID 108e9186e8c5677a',
      ),
    ).toBe(true);
  });

  it('returns false on an unrelated bare 409 (not the tlog dedupe shape)', () => {
    expect(looksLikeTlogDuplicate('npm error code E409\nnpm error 409 Conflict')).toBe(false);
  });

  it('returns false on undefined / empty', () => {
    expect(looksLikeTlogDuplicate(undefined)).toBe(false);
    expect(looksLikeTlogDuplicate('')).toBe(false);
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
        return Promise.reject(new ExecError('E404', '', '404', 1));
      }
      // publish: simulate the retry-race E403
      return Promise.reject(
        new ExecError(
          'publish failed',
          '',
          'npm error code E403\nnpm error 403 You cannot publish over the previously published versions: 0.2.0.',
          1,
        ),
      );
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
    const pkgJson = JSON.parse(readFileSync(`${repo}/pkg/package.json`, 'utf8')) as {
      optionalDependencies: Record<string, string>;
    };
    expect(pkgJson.optionalDependencies['demo-cli-linux-x64-gnu']).toBe('0.2.0');
  });
});

describe('publishPlatforms: Sigstore tlog dedupe race (#399)', () => {
  // The attestation edition of the E403 retry race above. npm re-submits a
  // byte-identical `--provenance` attestation and Sigstore/Rekor rejects the
  // duplicate with TLOG_CREATE_ENTRY_ERROR (HTTP 409). A 409 here does NOT by
  // itself prove the platform package landed (the first submit may have
  // written the Rekor entry but failed the registry PUT), so the handler
  // re-probes `npm view`: present => benign dup (counts as published);
  // absent => actionable throw that a fresh run resolves.

  it('counts the platform package as published when TLOG 409 fires but the package IS on the registry', async () => {
    makeArtifact('linux-x64-gnu', 'demo.linux-x64-gnu.node', Buffer.from('napi'));
    let viewCount = 0;
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {
        viewCount += 1;
        // 1st view: pre-publish idempotency probe (not yet published).
        // 2nd view: catch-block re-probe (the attestation's submit landed it).
        if (viewCount === 1) {
          return Promise.reject(new ExecError('E404', '', '404', 1));
        }
        return Promise.resolve(ok('0.2.0\n'));
      }
      return Promise.reject(
        new ExecError(
          'publish failed',
          '',
          'npm error code TLOG_CREATE_ENTRY_ERROR\n' +
            'npm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log with UUID 108e9186e8c5677a',
          1,
        ),
      );
    });

    const r = await publishPlatforms(basePkg({ targets: ['linux-x64-gnu'] }), '0.2.0', makeCtx());
    expect(r.published).toEqual(['demo-cli-linux-x64-gnu']);
    const pkgJson = JSON.parse(readFileSync(`${repo}/pkg/package.json`, 'utf8')) as {
      optionalDependencies: Record<string, string>;
    };
    expect(pkgJson.optionalDependencies['demo-cli-linux-x64-gnu']).toBe('0.2.0');
    // The catch-block re-probe is the last npm call and queries the exact
    // platform coordinate with the `version` field, scoped to cwd — pins the
    // full argv + options object.
    const npmCalls = execMock.mock.calls.filter((c) => c[0] === 'npm');
    expect(npmCalls[npmCalls.length - 1]).toEqual([
      'npm',
      ['view', 'demo-cli-linux-x64-gnu@0.2.0', 'version'],
      { cwd: '/repo' },
    ]);
  });

  it('throws an actionable re-run error on TLOG 409 when the platform package is NOT on the registry, before rewriting main', async () => {
    makeArtifact('linux-x64-gnu', 'demo.linux-x64-gnu.node', Buffer.from('napi'));
    execMock.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'view') {
        // Both probes miss: the attestation was orphaned, the PUT never landed.
        return Promise.reject(new ExecError('E404', '', '404', 1));
      }
      return Promise.reject(
        new ExecError(
          'publish failed',
          '',
          'npm error code TLOG_CREATE_ENTRY_ERROR\n' +
            'npm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log',
          1,
        ),
      );
    });

    await expect(
      publishPlatforms(basePkg({ targets: ['linux-x64-gnu'] }), '0.2.0', makeCtx()),
    ).rejects.toThrow(/Re-run the release to mint a fresh attestation/);
    // Failed before the rewrite: main package.json must NOT carry optionalDependencies.
    const pkgJson = JSON.parse(readFileSync(`${repo}/pkg/package.json`, 'utf8')) as Record<string, unknown>;
    expect(pkgJson.optionalDependencies).toBeUndefined();
  });
});
