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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publish } from './publish.js';
import { TransientError, attachHandlerMeta, type Handler } from './types.js';

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
globs = ["packages/ts/**"]
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
    // Swap to a pypi-kind config so the completeness check actually
    // fires (vanilla-npm-noarch and crates rows skip — npm and cargo
    // both publish from the source tree directly, so no artifact ever
    // lives under artifacts/).
    writeRepoFile(
      'putitoutthere.toml',
      `[putitoutthere]
version = 1
[[package]]
name  = "lib-py"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
`,
    );
    writeRepoFile('packages/py/pyproject.toml', '[project]\nname = "lib-py"\nversion = "0.0.0"\n');
    writeRepoFile('packages/py/lib_py/__init__.py', '');
    git(['add', '-A']);
    git(['commit', '-m', 'pypi setup\n\nrelease: patch']);
    rmSync(join(repo, 'artifacts'), { recursive: true });
    process.env.PYPI_API_TOKEN = 'tok';

    const handler = makeHandler({ kind: 'pypi' });
    await expect(
      publish({ cwd: repo, handlerFor: () => handler }),
    ).rejects.toThrow(/completeness|missing/i);
    expect(handler.publish).not.toHaveBeenCalled();

    delete process.env.PYPI_API_TOKEN;
  });

  it('throws PIOT_PUBLISH_EMPTY_PLAN when the plan is empty (cascade did not trigger)', async () => {
    // Tag HEAD so the package has a last tag, then commit a file
    // OUTSIDE the package's globs. Cascade has no work to do.
    // Reaching publish in this state means the workflow gate was
    // bypassed or the engine is inconsistent — either way, surface
    // it loudly with a fingerprintable code rather than returning
    // a silent zero.
    git(['tag', 'lib-js-v0.1.0']);
    writeRepoFile('docs/notes.md', 'unrelated to packages/ts/**');
    git(['add', '-A']);
    git(['commit', '-m', 'docs: unrelated\n\nrelease: minor']);

    const handler = makeHandler();
    await expect(
      publish({ cwd: repo, handlerFor: () => handler }),
    ).rejects.toThrow(/PIOT_PUBLISH_EMPTY_PLAN/);
    expect(handler.publish).not.toHaveBeenCalled();
  });

  it('throws PIOT_PUBLISH_EMPTY_PLAN on `release: skip` too (gate, not engine, owns skip)', async () => {
    // `release: skip` is a workflow-gate concern: the plan job
    // returns [] and the gate skips the publish job. If publish is
    // reached anyway (gate misconfigured, direct CLI invocation),
    // the engine's invariant — "publish runs => something publishes"
    // — wins. Throws.
    git(['commit', '--allow-empty', '-m', 'chore\n\nrelease: skip']);
    const handler = makeHandler();
    await expect(
      publish({ cwd: repo, handlerFor: () => handler }),
    ).rejects.toThrow(/PIOT_PUBLISH_EMPTY_PLAN/);
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
globs = ["packages/a/**"]

[[package]]
name       = "b"
kind       = "npm"
path       = "packages/b"
globs      = ["packages/b/**"]
depends_on = ["a"]

[[package]]
name       = "c"
kind       = "npm"
path       = "packages/c"
globs      = ["packages/c/**"]
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

  // Phase 2 / Idea 9: tool-version metadata attached by a handler must
  // reach the rendered job-summary markdown via FailureContext, so a
  // foreign agent reading the rendered failure can see "what version
  // of twine/npm/cargo was running" without re-running anything.
  it('threads handler-attached tool versions into the failure dump', async () => {
    // Wire up a temp $GITHUB_STEP_SUMMARY so we can inspect the markdown.
    const summaryPath = join(repo, '_step_summary.md');
    writeFileSync(summaryPath, '', 'utf8');
    const prev = process.env.GITHUB_STEP_SUMMARY;
    process.env.GITHUB_STEP_SUMMARY = summaryPath;

    try {
      const err = new Error('twine upload failed');
      attachHandlerMeta(err, {
        toolVersions: { twine: 'twine 5.1.0', python: 'Python 3.12.6' },
      });
      const handler = makeHandler({
        publish: vi.fn().mockRejectedValue(err),
      });
      await expect(
        publish({ cwd: repo, handlerFor: () => handler }),
      ).rejects.toThrow(/twine upload failed/);

      const md = readFileSync(summaryPath, 'utf8');
      expect(md).toContain('Tool versions');
      expect(md).toContain('twine 5.1.0');
      expect(md).toContain('Python 3.12.6');
    } finally {
      if (prev === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = prev;
    }
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

