/**
 * `putitoutthere publish` tests. Integrates plan + preflight +
 * completeness + handlers + tag into one pipeline.
 *
 * Issue #22. Plan: §13 (whole flow), §13.6 (no-push tag model).
 *
 * Uses mocked handlers + git so we assert orchestration without
 * hitting networks or shelling to cargo/twine/npm.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publish } from './publish.js';
import { TransientError, type Handler } from './types.js';

let repo: string;
function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}
function writeRepoFile(relative: string, content: string): void {
  const full = join(repo, relative);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

const TOML = `
[putitoutthere]
version = 1

[[package]]
name  = "lib-js"
kind  = "npm"
path  = "packages/ts"
paths = ["packages/ts/**"]
`;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'publish-test-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);

  writeRepoFile('putitoutthere.toml', TOML);
  writeRepoFile('packages/ts/package.json', JSON.stringify({ name: 'lib-js', version: '0.0.0', repository: { type: 'git', url: 'x' } }));
  writeRepoFile('packages/ts/index.ts', 'x');
  git(['add', '-A']);
  git(['commit', '-m', 'feat: initial\n\nrelease: patch']);

  // Stage artifacts so the completeness check passes.
  const artifactsRoot = join(repo, 'artifacts');
  mkdirSync(join(artifactsRoot, 'lib-js-pkg'), { recursive: true });
  writeFileSync(join(artifactsRoot, 'lib-js-pkg/package.json'), '{}', 'utf8');

  process.env.NODE_AUTH_TOKEN = 'npm-token';
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.NODE_AUTH_TOKEN;
});

function makeHandler(over: Partial<Handler> = {}): Handler {
  return {
    kind: 'npm',
    isPublished: vi.fn().mockResolvedValue(false),
    writeVersion: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({ status: 'published', url: 'https://npm/lib-js/0.1.0' }),
    ...over,
  };
}

describe('publish: happy path', () => {
  it('invokes the handler for each cascaded package and creates a tag', async () => {
    const handler = makeHandler();
    const result = await publish({
      cwd: repo,
      handlerFor: () => handler,
    });
    expect(handler.writeVersion).toHaveBeenCalledTimes(1);
    expect(handler.publish).toHaveBeenCalledTimes(1);

    // Tag should exist now.
    const tags = git(['tag', '-l']);
    expect(tags).toContain('lib-js-v0.1.0');

    // Result reports success.
    expect(result.ok).toBe(true);
    expect(result.published.map((p) => p.package)).toEqual(['lib-js']);
  });

  it('dry-run: skips handler.publish and does not tag', async () => {
    const handler = makeHandler();
    const result = await publish({
      cwd: repo,
      handlerFor: () => handler,
      dryRun: true,
    });
    expect(handler.publish).not.toHaveBeenCalled();
    expect(git(['tag', '-l'])).toBe('');
    expect(result.ok).toBe(true);
  });

  it('short-circuits on already-published (no tag, clean exit)', async () => {
    const handler = makeHandler({
      isPublished: vi.fn().mockResolvedValue(true),
    });
    const result = await publish({
      cwd: repo,
      handlerFor: () => handler,
    });
    expect(handler.publish).not.toHaveBeenCalled();
    // Still tag -- re-runs with already-published don't re-tag.
    expect(result.ok).toBe(true);
  });

  it('retries handler.publish on TransientError (#133)', async () => {
    const publishFn = vi
      .fn()
      .mockRejectedValueOnce(new TransientError('registry 503'))
      .mockResolvedValue({ status: 'published', url: 'https://npm/lib-js/0.1.0' });
    const handler = makeHandler({ publish: publishFn });
    const result = await publish({ cwd: repo, handlerFor: () => handler });
    expect(publishFn).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  }, 10_000);
});

describe('publish: pre-flight and completeness', () => {
  it('aborts on missing auth', async () => {
    delete process.env.NODE_AUTH_TOKEN;
    const handler = makeHandler();
    await expect(
      publish({ cwd: repo, handlerFor: () => handler }),
    ).rejects.toThrow(/NODE_AUTH_TOKEN|auth/i);
    expect(handler.publish).not.toHaveBeenCalled();
  });

  it('aborts on incomplete artifacts', async () => {
    // Swap to a crates-kind config so the completeness check actually
    // fires (vanilla-npm-noarch rows skip the check since npm publishes
    // from the source tree directly).
    writeRepoFile(
      'putitoutthere.toml',
      `[putitoutthere]
version = 1
[[package]]
name  = "lib-rust"
kind  = "crates"
path  = "packages/rust"
paths = ["packages/rust/**"]
`,
    );
    writeRepoFile('packages/rust/Cargo.toml', '[package]\nname = "lib-rust"\nversion = "0.0.0"\n');
    writeRepoFile('packages/rust/src/lib.rs', '// x');
    git(['add', '-A']);
    git(['commit', '-m', 'crates setup\n\nrelease: patch']);
    rmSync(join(repo, 'artifacts'), { recursive: true });
    process.env.CARGO_REGISTRY_TOKEN = 'tok';

    const handler = makeHandler({ kind: 'crates' });
    await expect(
      publish({ cwd: repo, handlerFor: () => handler }),
    ).rejects.toThrow(/completeness|missing/i);
    expect(handler.publish).not.toHaveBeenCalled();

    delete process.env.CARGO_REGISTRY_TOKEN;
  });

  it('returns empty result when plan is empty (nothing to release)', async () => {
    // Commit a skip trailer on top; plan returns [].
    git(['commit', '--allow-empty', '-m', 'chore\n\nrelease: skip']);
    const handler = makeHandler();
    const result = await publish({
      cwd: repo,
      handlerFor: () => handler,
    });
    expect(result.ok).toBe(true);
    expect(result.published).toEqual([]);
    expect(handler.publish).not.toHaveBeenCalled();
  });
});

describe('publish: publish order (toposort)', () => {
  it('publishes dependencies before dependents', async () => {
    const TOML2 = `
[putitoutthere]
version = 1

[[package]]
name  = "a"
kind  = "npm"
path  = "packages/a"
paths = ["packages/a/**"]

[[package]]
name       = "b"
kind       = "npm"
path       = "packages/b"
paths      = ["packages/b/**"]
depends_on = ["a"]

[[package]]
name       = "c"
kind       = "npm"
path       = "packages/c"
paths      = ["packages/c/**"]
depends_on = ["a", "b"]
`;
    // Rebuild repo with three packages.
    rmSync(repo, { recursive: true, force: true });
    repo = mkdtempSync(join(tmpdir(), 'publish-test-'));
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['config', 'tag.gpgsign', 'false']);
    writeRepoFile('putitoutthere.toml', TOML2);
    for (const p of ['a', 'b', 'c']) {
      writeRepoFile(`packages/${p}/package.json`, JSON.stringify({ name: p, version: '0.0.0', repository: { type: 'git', url: 'x' } }));
      writeRepoFile(`packages/${p}/index.ts`, 'x');
    }
    git(['add', '-A']);
    git(['commit', '-m', 'feat: initial']);

    const artifactsRoot = join(repo, 'artifacts');
    for (const p of ['a', 'b', 'c']) {
      mkdirSync(join(artifactsRoot, `${p}-pkg`), { recursive: true });
      writeFileSync(join(artifactsRoot, `${p}-pkg/package.json`), '{}', 'utf8');
    }
    process.env.NODE_AUTH_TOKEN = 'tok';

    const calls: string[] = [];
    const handler = makeHandler({
      publish: vi.fn().mockImplementation(async (pkg: { name: string }) => {
        calls.push(pkg.name);
        return Promise.resolve({ status: 'published' as const });
      }),
    });
    const result = await publish({ cwd: repo, handlerFor: () => handler });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['a', 'b', 'c']);
  });
});

describe('publish: handler failure', () => {
  it('surfaces the error and leaves other packages untouched', async () => {
    const handler = makeHandler({
      publish: vi.fn().mockRejectedValue(new Error('registry 500')),
    });
    await expect(
      publish({ cwd: repo, handlerFor: () => handler }),
    ).rejects.toThrow(/500|registry/);
    // No tag created on failure.
    expect(git(['tag', '-l'])).toBe('');
  });
});

describe('publish: pkg.path resolution', () => {
  it('passes absolute pkg.path to handlers regardless of process.cwd()', async () => {
    // Handlers do `readFileSync(join(pkg.path, 'Cargo.toml'))` which resolves
    // against process.cwd(). Anchoring pkg.path to opts.cwd at the top of
    // publish() ensures e2e harnesses / monorepo orchestrators that invoke
    // the CLI with `--cwd /elsewhere` get the right path.
    const seen: { writeVersion?: string; publish?: string } = {};
    const handler = makeHandler({
      writeVersion: vi.fn().mockImplementation(async (pkg: { path: string }) => {
        seen.writeVersion = pkg.path;
        return Promise.resolve([]);
      }),
      publish: vi.fn().mockImplementation(async (pkg: { path: string }) => {
        seen.publish = pkg.path;
        return Promise.resolve({ status: 'published' as const });
      }),
    });
    await publish({ cwd: repo, handlerFor: () => handler });
    expect(seen.writeVersion).toBe(join(repo, 'packages/ts'));
    expect(seen.publish).toBe(join(repo, 'packages/ts'));
  });
});

describe('publish: --preflight-check', () => {
  it('refuses when a scope mismatch is detected', async () => {
    const handler = makeHandler();
    await expect(
      publish({
        cwd: repo,
        handlerFor: () => handler,
        preflightCheck: true,
        dryRun: true,
        inspectFn: () => Promise.resolve({
          registry: 'npm',
          source_digest: 'abc',
          format: 'granular',
          username: 'alice',
          scope_row: {
            readonly: false,
            automation: false,
            packages: ['@acme/other'],
            scopes: null,
            orgs: null,
            expires_at: null,
            cidr_whitelist: null,
            created: null,
          },
        }),
      }),
    ).rejects.toThrow(/preflight-check refused/);
    expect(handler.publish).not.toHaveBeenCalled();
  });

  it('passes through when scope matches', async () => {
    const handler = makeHandler();
    const result = await publish({
      cwd: repo,
      handlerFor: () => handler,
      preflightCheck: true,
      inspectFn: () => Promise.resolve({
        registry: 'npm',
        source_digest: 'abc',
        format: 'granular',
        username: 'alice',
        scope_row: {
          readonly: false,
          automation: false,
          packages: ['lib-js'],
          scopes: null,
          orgs: null,
          expires_at: null,
          cidr_whitelist: null,
          created: null,
        },
      }),
    });
    expect(result.ok).toBe(true);
    expect(handler.publish).toHaveBeenCalledTimes(1);
  });
});
