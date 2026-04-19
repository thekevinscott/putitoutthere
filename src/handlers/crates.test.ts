/**
 * crates.io handler tests.
 *
 * Issue #16. Plan: §7.4, §13.1, §14.5, §16.1.
 *
 * Mocks: global fetch for isPublished; node:child_process for publish;
 * temp files for writeVersion.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { crates } from './crates.js';
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
    dryRun: false,
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
    paths: ['**'],
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

  it('skips the network when ctx.dryRun is set', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    const result = await crates.publish(
      { ...basePkg(), path: dir },
      '0.1.0',
      makeCtx({ cwd: dir, dryRun: true }),
    );
    expect(result.status).toBe('skipped');
    expect(execMock).not.toHaveBeenCalled();
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
