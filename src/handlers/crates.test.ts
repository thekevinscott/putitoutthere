/**
 * crates.io handler tests.
 *
 * Issue #16. Plan: §7.4, §13.1, §14.5, §16.1.
 *
 * Mocks: global fetch for isPublished; node:child_process for publish;
 * temp files for writeVersion.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { crates, scanDirtyOutsideManifest } from './crates.js';
import type { Ctx } from '../types.js';

import type * as ChildProcess from 'node:child_process';

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return {
    ...actual,
    execFileSync: vi.fn(actual.execFileSync),
  };
});

const execMock = vi.mocked(execFileSync);

function makeCtx(over: Partial<Ctx> = {}): Ctx {
  return {
    cwd: '.',
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    env: {},
    artifacts: { get: () => '', has: () => false },
    ...over,
  };
}

function basePkg(over: Partial<{ name: string; path: string; crate?: string }> = {}): Parameters<typeof crates.isPublished>[0] {
  return {
    name: 'demo-rust',
    kind: 'crates',
    path: '.',
    globs: ['**'],
    depends_on: [],
    first_version: '0.1.0',
    crate: 'demo-crate',
    ...over,
  };
}

const ENV_BAK = { ...process.env };

beforeEach(() => {
  execMock.mockReset();
  delete process.env.CARGO_REGISTRY_TOKEN;
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ENV_BAK)) delete process.env[k];
  }
  Object.assign(process.env, ENV_BAK);
});

describe('crates.isPublished', () => {
  it('returns true on 200 from crates.io', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: { num: '0.1.0' } }), { status: 200 }),
    );
    const ok = await crates.isPublished(basePkg(), '0.1.0', makeCtx());
    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://crates.io/api/v1/crates/demo-crate/0.1.0',
      expect.objectContaining({ method: 'GET' }) as object,
    );
    fetchSpy.mockRestore();
  });

  it('returns false on 404', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    expect(await crates.isPublished(basePkg(), '0.1.0', makeCtx())).toBe(false);
    fetchSpy.mockRestore();
  });

  it('uses package.name when no explicit crate field', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    const pkg = basePkg();
    delete (pkg as { crate?: string }).crate;
    await crates.isPublished(pkg, '0.1.0', makeCtx());
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://crates.io/api/v1/crates/demo-rust/0.1.0',
      expect.any(Object) as object,
    );
    fetchSpy.mockRestore();
  });

  it('throws TransientError on 5xx', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 503 }),
    );
    await expect(crates.isPublished(basePkg(), '0.1.0', makeCtx())).rejects.toThrow(/transient|503/i);
    fetchSpy.mockRestore();
  });
});

describe('crates.writeVersion', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'crates-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rewrites the [package] version in Cargo.toml', async () => {
    const cargoPath = join(dir, 'Cargo.toml');
    writeFileSync(
      cargoPath,
      `[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde = "1"\n`,
      'utf8',
    );
    const paths = await crates.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.3',
      makeCtx({ cwd: dir }),
    );
    const out = readFileSync(cargoPath, 'utf8');
    expect(out).toContain('version = "0.2.3"');
    expect(out).not.toContain('version = "0.1.0"');
    expect(out).toContain('name = "demo"');
    expect(paths).toContain(cargoPath);
  });

  it('is idempotent when version already matches', async () => {
    const cargoPath = join(dir, 'Cargo.toml');
    writeFileSync(cargoPath, `[package]\nname = "demo"\nversion = "1.0.0"\n`, 'utf8');
    const paths = await crates.writeVersion(
      { ...basePkg(), path: dir },
      '1.0.0',
      makeCtx({ cwd: dir }),
    );
    expect(paths).toEqual([]);
    expect(readFileSync(cargoPath, 'utf8')).toContain('version = "1.0.0"');
  });

  it('throws when Cargo.toml is missing', async () => {
    await expect(
      crates.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir })),
    ).rejects.toThrow(/Cargo\.toml/);
  });

  it('throws when the [package] version line is missing', async () => {
    const cargoPath = join(dir, 'Cargo.toml');
    writeFileSync(cargoPath, `[workspace]\nmembers = ["a"]\n`, 'utf8');
    await expect(
      crates.writeVersion({ ...basePkg(), path: dir }, '0.1.0', makeCtx({ cwd: dir })),
    ).rejects.toThrow(/version/i);
  });

  it('preserves comments and whitespace around the version line', async () => {
    const cargoPath = join(dir, 'Cargo.toml');
    writeFileSync(
      cargoPath,
      `[package]
name    = "demo"
# keep me
version = "0.1.0"   # trailing comment
edition = "2021"
`,
      'utf8',
    );
    await crates.writeVersion(
      { ...basePkg(), path: dir },
      '0.2.0',
      makeCtx({ cwd: dir }),
    );
    const out = readFileSync(cargoPath, 'utf8');
    expect(out).toContain('# keep me');
    expect(out).toContain('# trailing comment');
    expect(out).toContain('version = "0.2.0"');
  });
});

describe('crates.publish', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'crates-pub-'));
    mkdirSync(join(dir, '.cargo'), { recursive: true });
    writeFileSync(join(dir, 'Cargo.toml'), `[package]\nname = "demo"\nversion = "0.1.0"\n`, 'utf8');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips when already published', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    const result = await crates.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir }),
    );
    expect(result.status).toBe('already-published');
    expect(execMock).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('runs cargo publish when not already published', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockReturnValueOnce(Buffer.from('ok'));
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    const result = await crates.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    expect(result.status).toBe('published');
    expect(execMock).toHaveBeenCalledWith(
      'cargo',
      expect.arrayContaining(['publish', '--allow-dirty']) as string[],
      expect.any(Object) as object,
    );
    fetchSpy.mockRestore();
  });

  it('threads configured features into cargo publish (#169)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    // scanDirtyOutsideManifest spawns git several times before cargo; returning
    // null from the first rev-parse short-circuits that scan so only the
    // cargo invocation we care about lands in the mock calls list.
    execMock.mockImplementation((file: string) => {
      if (file === 'git') throw new Error('not a git repo');
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    await crates.publish(
      { ...basePkg(), path: dir, features: ['cli', 'serde'] },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const args = cargoCall![1] as string[];
    const idx = args.indexOf('--features');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('cli,serde');
    fetchSpy.mockRestore();
  });

  it('omits --features when the config has none (#169)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') throw new Error('not a git repo');
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    await crates.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const args = cargoCall![1] as string[];
    expect(args).not.toContain('--features');
    fetchSpy.mockRestore();
  });

  it('omits --features when the features list is empty (#169)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') throw new Error('not a git repo');
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    await crates.publish(
      { ...basePkg(), path: dir, features: [] },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const args = cargoCall![1] as string[];
    expect(args).not.toContain('--features');
    fetchSpy.mockRestore();
  });

  it('omits --no-default-features when the flag is undefined (#169 follow-up)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') throw new Error('not a git repo');
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    await crates.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const args = cargoCall![1] as string[];
    expect(args).not.toContain('--no-default-features');
    fetchSpy.mockRestore();
  });

  it('omits --no-default-features when the flag is false (#169 follow-up)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') throw new Error('not a git repo');
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    await crates.publish(
      { ...basePkg(), path: dir, no_default_features: false },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const args = cargoCall![1] as string[];
    expect(args).not.toContain('--no-default-features');
    fetchSpy.mockRestore();
  });

  it('includes --no-default-features when the flag is true (#169 follow-up)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') throw new Error('not a git repo');
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    await crates.publish(
      { ...basePkg(), path: dir, no_default_features: true },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const args = cargoCall![1] as string[];
    expect(args).toContain('--no-default-features');
    fetchSpy.mockRestore();
  });

  it('combines --features and --no-default-features in the right order (#169 follow-up)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') throw new Error('not a git repo');
      return Buffer.from('ok');
    });
    process.env.CARGO_REGISTRY_TOKEN = 'secret';

    await crates.publish(
      { ...basePkg(), path: dir, features: ['cli', 'serde'], no_default_features: true },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'secret' } }),
    );
    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const args = cargoCall![1] as string[];
    const featuresIdx = args.indexOf('--features');
    const noDefaultIdx = args.indexOf('--no-default-features');
    expect(featuresIdx).toBeGreaterThanOrEqual(0);
    expect(args[featuresIdx + 1]).toBe('cli,serde');
    expect(noDefaultIdx).toBeGreaterThan(featuresIdx);
    fetchSpy.mockRestore();
  });

  it('passes a minimal env to cargo (#138): includes PATH, excludes unrelated parent secrets', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation((file: string) => {
      if (file === 'git') throw new Error('not a git repo');
      return Buffer.from('ok');
    });
    process.env.UNRELATED_AWS_SECRET = 'parent-leak-should-not-ship';
    process.env.PATH = process.env.PATH ?? '/usr/bin';

    await crates.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'ship-this-one' } }),
    );

    const cargoCall = execMock.mock.calls.find((c) => c[0] === 'cargo');
    expect(cargoCall).toBeDefined();
    const envSpec = (cargoCall![2] as { env: Record<string, string> }).env;
    // ctx.env is forwarded (declared passthrough).
    expect(envSpec.CARGO_REGISTRY_TOKEN).toBe('ship-this-one');
    // Explicit extra set by the handler.
    expect(envSpec.CARGO_TERM_VERBOSE).toBe('true');
    // PATH stays so cargo can be found.
    expect(envSpec.PATH).toBe(process.env.PATH);
    // Unrelated parent secret is dropped.
    expect(envSpec.UNRELATED_AWS_SECRET).toBeUndefined();

    delete process.env.UNRELATED_AWS_SECRET;
    fetchSpy.mockRestore();
  });

  it('reports cargo publish failure', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    execMock.mockImplementation(() => {
      throw Object.assign(new Error('exit 1'), { stderr: Buffer.from('permission denied') });
    });
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    await expect(
      crates.publish(
        { ...basePkg(), path: dir },
        '0.1.0',
        makeCtx({ cwd: dir, env: { CARGO_REGISTRY_TOKEN: 'tok' } }),
      ),
    ).rejects.toThrow(/cargo publish|exit 1|permission denied/i);
    fetchSpy.mockRestore();
  });
});

describe('scanDirtyOutsideManifest (#135)', () => {
  // spawnSync is NOT mocked (only execFileSync is), so use it for real
  // git setup without fighting the execMock.
  function git(args: string[], cwd: string): void {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    }
  }

  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'crates-scan-'));
    git(['init', '-q', '-b', 'main'], repo);
    git(['config', 'user.email', 't@e'], repo);
    git(['config', 'user.name', 'T'], repo);
    git(['config', 'commit.gpgsign', 'false'], repo);
    // Route execFileSync('git', ...) back to the real binary. mockReset
    // in the parent beforeEach stripped the implementation.
    const realGit = (file: string, args: readonly string[] = [], options: { cwd?: string; encoding?: string } = {}): Buffer | string => {
      if (file !== 'git') throw new Error(`unexpected exec: ${file}`);
      const r = spawnSync('git', args as string[], {
        cwd: options.cwd,
        encoding: (options.encoding as BufferEncoding | undefined) ?? 'utf8',
      });
      if (r.status !== 0) {
        throw Object.assign(new Error(`git exit ${r.status ?? -1}`), {
          stderr: Buffer.from(r.stderr ?? ''),
          status: r.status,
        });
      }
      return options.encoding ? r.stdout : Buffer.from(r.stdout);
    };
    execMock.mockImplementation(realGit as unknown as typeof execFileSync);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('returns an empty list when only the managed Cargo.toml is dirty', () => {
    writeFileSync(join(repo, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n', 'utf8');
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'init'], repo);
    writeFileSync(join(repo, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.2.0"\n', 'utf8');
    expect(scanDirtyOutsideManifest(repo, repo)).toEqual([]);
  });

  it('flags a stray dirty file outside the package dir', () => {
    mkdirSync(join(repo, 'crate'), { recursive: true });
    writeFileSync(join(repo, 'crate/Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n', 'utf8');
    writeFileSync(join(repo, 'README.md'), 'before\n', 'utf8');
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'init'], repo);
    writeFileSync(join(repo, 'crate/Cargo.toml'), '[package]\nname = "demo"\nversion = "0.2.0"\n', 'utf8');
    writeFileSync(join(repo, 'README.md'), 'stray edit\n', 'utf8');
    const result = scanDirtyOutsideManifest(repo, join(repo, 'crate'));
    expect(result).toContain('README.md');
    expect(result).not.toContain('crate/Cargo.toml');
  });

  it('flags a dirty sibling file inside the package dir that is not Cargo.toml', () => {
    mkdirSync(join(repo, 'crate/src'), { recursive: true });
    writeFileSync(join(repo, 'crate/Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n', 'utf8');
    writeFileSync(join(repo, 'crate/src/lib.rs'), 'fn a(){}\n', 'utf8');
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'init'], repo);
    // Only src/lib.rs dirty -- the managed Cargo.toml is unchanged. Still
    // a surprise: our writeVersion didn't produce this edit.
    writeFileSync(join(repo, 'crate/src/lib.rs'), 'fn b(){}\n', 'utf8');
    const result = scanDirtyOutsideManifest(repo, join(repo, 'crate'));
    expect(result).toContain('crate/src/lib.rs');
  });

  it('skips files under artifactsRoot — engine-managed scratch (#244)', () => {
    // The reusable workflow's `actions/download-artifact@v4` step always
    // creates `artifacts/` under cwd, even when nothing was uploaded
    // (crates-only fixtures). git status sees `?? artifacts/` and the
    // pre-publish dirty-check would refuse cargo publish unless it
    // recognises this directory as engine-managed.
    mkdirSync(join(repo, 'crate'), { recursive: true });
    writeFileSync(join(repo, 'crate/Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n', 'utf8');
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'init'], repo);
    writeFileSync(join(repo, 'crate/Cargo.toml'), '[package]\nname = "demo"\nversion = "0.2.0"\n', 'utf8');
    mkdirSync(join(repo, 'artifacts/some-pkg'), { recursive: true });
    writeFileSync(join(repo, 'artifacts/some-pkg/file.txt'), 'x', 'utf8');
    const result = scanDirtyOutsideManifest(repo, join(repo, 'crate'), join(repo, 'artifacts'));
    expect(result).toEqual([]);
  });

  it('still flags non-artifacts-root files when artifactsRoot is provided', () => {
    mkdirSync(join(repo, 'crate'), { recursive: true });
    writeFileSync(join(repo, 'crate/Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n', 'utf8');
    writeFileSync(join(repo, 'README.md'), 'init\n', 'utf8');
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'init'], repo);
    writeFileSync(join(repo, 'crate/Cargo.toml'), '[package]\nname = "demo"\nversion = "0.2.0"\n', 'utf8');
    writeFileSync(join(repo, 'README.md'), 'stray\n', 'utf8');
    mkdirSync(join(repo, 'artifacts'), { recursive: true });
    writeFileSync(join(repo, 'artifacts/file.txt'), 'x', 'utf8');
    const result = scanDirtyOutsideManifest(repo, join(repo, 'crate'), join(repo, 'artifacts'));
    expect(result).toContain('README.md');
    expect(result?.some((p) => p.startsWith('artifacts'))).toBe(false);
  });

  it('returns null when cwd is not inside a git worktree', () => {
    const plain = mkdtempSync(join(tmpdir(), 'crates-scan-nogit-'));
    try {
      expect(scanDirtyOutsideManifest(plain, plain)).toBeNull();
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('crates.publish rejects with a clear error when an unrelated file is dirty', async () => {
    mkdirSync(join(repo, 'crate'), { recursive: true });
    writeFileSync(join(repo, 'crate/Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n', 'utf8');
    writeFileSync(join(repo, 'README.md'), 'init\n', 'utf8');
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'init'], repo);
    writeFileSync(join(repo, 'README.md'), 'stray edit\n', 'utf8');
    writeFileSync(join(repo, 'crate/Cargo.toml'), '[package]\nname = "demo"\nversion = "0.2.0"\n', 'utf8');

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    await expect(
      crates.publish(
        { ...basePkg(), path: join(repo, 'crate') },
        '0.2.0',
        makeCtx({ cwd: repo, env: { CARGO_REGISTRY_TOKEN: 'tok' } }),
      ),
    ).rejects.toThrow(/unexpected dirty|README\.md/);
    fetchSpy.mockRestore();
  });
});
