/**
 * `publish` orchestration unit tests.
 *
 * `publish` is the subject: it re-runs plan, runs the pre-flight +
 * completeness gates, then publishes each package in dep order and tags
 * it. Every collaborator is isolated — `loadConfig`, `plan`, the
 * `preflight` gates, `checkCompleteness`, `normalizeArtifactLayout`,
 * `headCommit`, `ensureTag`, and `dumpFailure` are automocked and driven
 * per scenario; the handler is injected via `handlerFor`. `withRetry`
 * runs for real (retry is part of the orchestration under test). So each
 * case asserts the wiring — which gate aborts, publish order, tag-on-
 * success, no-tag-on-failure — without a real repo, network, or tool.
 *
 * The whole flow against real plan/preflight/completeness is pinned in
 * `tests/integration/publish.integration.test.ts` and the e2e tier.
 *
 * Issue #22.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from './config.js';
import { loadConfig } from './config.js';
import { checkCompleteness } from './completeness.js';
import { normalizeArtifactLayout } from './normalize-artifacts.js';
import { ensureTag } from './ensure-tag.js';
import { headCommit } from './git.js';
import { type MatrixRow, plan } from './plan.js';
import {
  requireAuth,
  requireCargoShape,
  requireCratesMetadata,
  requirePackageJsonShape,
  requireProvenanceMetadata,
  requirePyprojectShape,
  requirePypiVersionSource,
  requireRepoPublic,
  requireRepoUrlMatch,
} from './preflight.js';
import { publish } from './publish.js';
import { readHandlerMeta, type Ctx, type Handler } from './types.js';
import { dumpFailure } from './verbose.js';

vi.mock('./config.js');
vi.mock('./plan.js');
vi.mock('./preflight.js');
vi.mock('./completeness.js');
vi.mock('./normalize-artifacts.js');
vi.mock('./ensure-tag.js');
vi.mock('./git.js');
vi.mock('./verbose.js');
vi.mock('./types.js');

const CWD = '/repo';

function npmPkg(name: string, path: string, depends_on: string[] = []): Package {
  return {
    name,
    kind: 'npm',
    path,
    globs: [`${path}/**`],
    depends_on,
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
  };
}

function pypiPkg(name: string, path: string): Package {
  return {
    name,
    kind: 'pypi',
    path,
    globs: [`${path}/**`],
    build: 'setuptools',
    depends_on: [],
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
  } as unknown as Package;
}

function configWith(...packages: Package[]): void {
  vi.mocked(loadConfig).mockReturnValue({
    putitoutthere: { version: 1 },
    packages,
  });
}

function row(pkg: Package): MatrixRow {
  return {
    name: pkg.name,
    kind: pkg.kind,
    version: '0.1.0',
    target: pkg.kind === 'npm' ? 'noarch' : 'sdist',
    runs_on: 'ubuntu-latest',
    artifact_name: `${pkg.name}-pkg`,
    artifact_path: pkg.kind === 'npm' ? 'package.json' : 'dist',
    path: pkg.path,
  };
}

/** A completeness map where every package is complete. */
function allComplete(...packages: Package[]): void {
  vi.mocked(checkCompleteness).mockReturnValue(
    new Map(packages.map((p) => [p.name, { ok: true, missing: [] }])),
  );
}

function makeHandler(over: Partial<Handler> = {}): Handler {
  return {
    kind: 'npm',
    isPublished: vi.fn().mockResolvedValue(false),
    latestVersion: vi.fn().mockResolvedValue(null),
    trustPosture: vi.fn().mockResolvedValue('token'),
    writeVersion: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({ status: 'published', url: 'https://npm/lib-js/0.1.0' }),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(headCommit).mockReturnValue('HEAD-SHA');
  vi.mocked(normalizeArtifactLayout).mockReturnValue(undefined);
  vi.mocked(readHandlerMeta).mockReturnValue(undefined);
  // Preflight gates pass by default; individual tests override one to abort.
  for (const gate of [
    requireAuth,
    requireProvenanceMetadata,
    requireCratesMetadata,
    requirePypiVersionSource,
    requirePyprojectShape,
    requireCargoShape,
    requirePackageJsonShape,
    requireRepoUrlMatch,
  ]) {
    vi.mocked(gate).mockReturnValue(undefined);
  }
  vi.mocked(requireRepoPublic).mockResolvedValue(undefined);
});

describe('publish: happy path', () => {
  it('invokes the handler for each cascaded package and creates a tag', async () => {
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    const handler = makeHandler();
    const result = await publish({ cwd: CWD, handlerFor: () => handler });

    expect(handler.writeVersion).toHaveBeenCalledTimes(1);
    expect(handler.publish).toHaveBeenCalledTimes(1);
    // Tag written for the published package at HEAD.
    expect(ensureTag).toHaveBeenCalledWith(
      '{name}-v{version}',
      'lib-js',
      '0.1.0',
      'HEAD-SHA',
      { cwd: CWD },
      expect.anything(),
    );
    expect(result.ok).toBe(true);
    expect(result.published.map((r) => r.package)).toEqual(['lib-js']);
  });

  it('short-circuits on already-published (auto-heals the tag, clean exit)', async () => {
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    const handler = makeHandler({ isPublished: vi.fn().mockResolvedValue(true) });
    const result = await publish({ cwd: CWD, handlerFor: () => handler });

    expect(handler.publish).not.toHaveBeenCalled();
    // Skip path still ensures the tag (auto-heal #407).
    expect(ensureTag).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it('retries handler.publish on a transient (5xx) failure (#133)', async () => {
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    const transient = Object.assign(new Error('registry 503'), { status: 503 });
    const publishFn = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValue({ status: 'published', url: 'https://npm/lib-js/0.1.0' });
    const handler = makeHandler({ publish: publishFn });

    const result = await publish({ cwd: CWD, handlerFor: () => handler });
    expect(publishFn).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  }, 10_000);
});

describe('publish: pre-flight and completeness', () => {
  it('aborts when the auth pre-flight fails', async () => {
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    vi.mocked(requireAuth).mockImplementation(() => {
      throw new Error('missing NODE_AUTH_TOKEN (auth)');
    });

    const handler = makeHandler();
    await expect(publish({ cwd: CWD, handlerFor: () => handler })).rejects.toThrow(
      /NODE_AUTH_TOKEN|auth/i,
    );
    expect(handler.publish).not.toHaveBeenCalled();
  });

  it('aborts when the repo-url pre-flight fails (manifest vs GITHUB_REPOSITORY)', async () => {
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    vi.mocked(requireRepoUrlMatch).mockImplementation(() => {
      throw new Error('[PIOT_REPO_URL_MISMATCH] repository.url mismatch');
    });

    const handler = makeHandler();
    await expect(publish({ cwd: CWD, handlerFor: () => handler })).rejects.toThrow(
      /PIOT_REPO_URL_MISMATCH/,
    );
    expect(handler.publish).not.toHaveBeenCalled();
  });

  it('aborts when the repo-visibility pre-flight fails (private repo)', async () => {
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    vi.mocked(requireRepoPublic).mockRejectedValue(
      new Error('[PIOT_REPO_PRIVATE] repository is private'),
    );

    const handler = makeHandler();
    await expect(publish({ cwd: CWD, handlerFor: () => handler })).rejects.toThrow(
      /PIOT_REPO_PRIVATE/,
    );
    expect(handler.publish).not.toHaveBeenCalled();
  });

  it('aborts on incomplete artifacts', async () => {
    const p = pypiPkg('lib-py', 'packages/py');
    configWith(p);
    const r = row(p);
    vi.mocked(plan).mockResolvedValue([r]);
    // Completeness reports a missing artifact for the package.
    vi.mocked(checkCompleteness).mockReturnValue(
      new Map([['lib-py', { ok: false, missing: [{ row: r, reason: 'missing sdist' }] }]]),
    );

    const handler = makeHandler({ kind: 'pypi' });
    await expect(publish({ cwd: CWD, handlerFor: () => handler })).rejects.toThrow(
      /completeness|missing/i,
    );
    expect(handler.publish).not.toHaveBeenCalled();
  });

  it('throws PIOT_PUBLISH_EMPTY_PLAN when the plan is empty (cascade did not trigger)', async () => {
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([]);

    const handler = makeHandler();
    await expect(publish({ cwd: CWD, handlerFor: () => handler })).rejects.toThrow(
      /PIOT_PUBLISH_EMPTY_PLAN/,
    );
    expect(handler.publish).not.toHaveBeenCalled();
  });

  it('throws PIOT_PUBLISH_EMPTY_PLAN on `release: skip` too (gate, not engine, owns skip)', async () => {
    // `release: skip` makes plan return [] — reaching publish in that
    // state is a misconfigured gate, and the engine's invariant wins.
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([]);

    const handler = makeHandler();
    await expect(publish({ cwd: CWD, handlerFor: () => handler })).rejects.toThrow(
      /PIOT_PUBLISH_EMPTY_PLAN/,
    );
    expect(handler.publish).not.toHaveBeenCalled();
  });
});

describe('publish: publish order (toposort)', () => {
  it('publishes dependencies before dependents', async () => {
    const a = npmPkg('a', 'packages/a');
    const b = npmPkg('b', 'packages/b', ['a']);
    const c = npmPkg('c', 'packages/c', ['a', 'b']);
    configWith(a, b, c);
    vi.mocked(plan).mockResolvedValue([row(a), row(b), row(c)]);
    allComplete(a, b, c);

    const calls: string[] = [];
    const handler = makeHandler({
      publish: vi.fn().mockImplementation((pkg: { name: string }) => {
        calls.push(pkg.name);
        return Promise.resolve({ status: 'published' as const });
      }),
    });
    const result = await publish({ cwd: CWD, handlerFor: () => handler });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['a', 'b', 'c']);
  });
});

describe('publish: handler failure', () => {
  it('surfaces the error and leaves the tag uncreated', async () => {
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    const handler = makeHandler({
      publish: vi.fn().mockRejectedValue(new Error('registry 500')),
    });
    await expect(publish({ cwd: CWD, handlerFor: () => handler })).rejects.toThrow(
      /500|registry/,
    );
    // No tag on failure; the failure was dumped.
    expect(ensureTag).not.toHaveBeenCalled();
    expect(dumpFailure).toHaveBeenCalledTimes(1);
  });

  it('threads handler-attached tool versions into the failure dump', async () => {
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    const err = new Error('twine upload failed');
    // The handler attached tool-version metadata; publish reads it back
    // via readHandlerMeta and threads it into the failure context.
    vi.mocked(readHandlerMeta).mockReturnValue({
      toolVersions: { twine: 'twine 5.1.0', python: 'Python 3.12.6' },
    });
    const handler = makeHandler({ publish: vi.fn().mockRejectedValue(err) });

    await expect(publish({ cwd: CWD, handlerFor: () => handler })).rejects.toThrow(
      /twine upload failed/,
    );

    expect(dumpFailure).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        package: 'lib-js',
        toolVersions: { twine: 'twine 5.1.0', python: 'Python 3.12.6' },
      }),
      expect.anything(),
    );
  });
});

describe('publish: additional branch coverage', () => {
  it('leaves an already-absolute pkg.path unchanged (no re-anchoring)', async () => {
    // The anchoring loop only resolves relative paths; an absolute path
    // must pass straight through to the handler untouched.
    const p = npmPkg('lib-js', '/abs/packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    let seen: string | undefined;
    const handler = makeHandler({
      publish: vi.fn().mockImplementation((pkg: { path: string }) => {
        seen = pkg.path;
        return Promise.resolve({ status: 'published' as const });
      }),
    });
    await publish({ cwd: CWD, handlerFor: () => handler });
    expect(seen).toBe('/abs/packages/ts');
  });

  it('skips tag creation when publish() itself reports already-published', async () => {
    // isPublished says "not yet", but the handler's publish() collapses an
    // in-flight race into already-published. That status must not tag.
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    const handler = makeHandler({
      isPublished: vi.fn().mockResolvedValue(false),
      publish: vi.fn().mockResolvedValue({ status: 'already-published' }),
    });
    const result = await publish({ cwd: CWD, handlerFor: () => handler });

    expect(handler.publish).toHaveBeenCalledTimes(1);
    expect(ensureTag).not.toHaveBeenCalled();
    expect(result.published.map((r) => r.result.status)).toEqual(['already-published']);
  });

  it('wraps a non-Error handler rejection before dumping and rethrowing', async () => {
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    const handler = makeHandler({
      publish: vi.fn().mockRejectedValue('raw-string-fail'),
    });
    await expect(publish({ cwd: CWD, handlerFor: () => handler })).rejects.toThrow(
      /raw-string-fail/,
    );
    expect(dumpFailure).toHaveBeenCalledTimes(1);
  });

  it('ignores configured packages that are absent from the plan when ordering', async () => {
    // `b` is configured but never planned; publishOrder must skip it
    // rather than try to publish it.
    const a = npmPkg('a', 'packages/a');
    const b = npmPkg('b', 'packages/b');
    configWith(a, b);
    vi.mocked(plan).mockResolvedValue([row(a)]);
    allComplete(a);

    const handler = makeHandler();
    const result = await publish({ cwd: CWD, handlerFor: () => handler });
    expect(result.published.map((r) => r.package)).toEqual(['a']);
  });

  it('tolerates a selected package whose depends_on is undefined', async () => {
    const p = { ...npmPkg('lib-js', 'packages/ts') };
    delete (p as { depends_on?: string[] }).depends_on;
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    const handler = makeHandler();
    const result = await publish({ cwd: CWD, handlerFor: () => handler });
    expect(result.ok).toBe(true);
  });

  it('exposes ctx.artifacts.get()/has() to handlers', async () => {
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    let gotPath: string | undefined;
    let hasResult: boolean | undefined;
    const handler = makeHandler({
      publish: vi.fn().mockImplementation((_pkg: unknown, _v: unknown, ctx: Ctx) => {
        gotPath = ctx.artifacts.get('my-artifact');
        hasResult = ctx.artifacts.has('my-artifact');
        return Promise.resolve({ status: 'published' as const });
      }),
    });
    await publish({ cwd: CWD, handlerFor: () => handler });

    // get(n) => join(artifactsRoot(cwd), n); has() is the post-completeness
    // stub that always returns true.
    expect(gotPath).toMatch(/[/\\]repo[/\\]artifacts[/\\]my-artifact$/);
    expect(hasResult).toBe(true);
  });
});

describe('publish: pkg.path resolution', () => {
  it('passes absolute pkg.path to handlers regardless of process.cwd()', async () => {
    // Handlers do `readFileSync(join(pkg.path, ...))` which resolves against
    // process.cwd(); publish anchors pkg.path to opts.cwd up front so a
    // `--cwd /elsewhere` invocation still points at the right tree.
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    const seen: { writeVersion?: string; publish?: string } = {};
    const handler = makeHandler({
      writeVersion: vi.fn().mockImplementation((pkg: { path: string }) => {
        seen.writeVersion = pkg.path;
        return Promise.resolve([]);
      }),
      publish: vi.fn().mockImplementation((pkg: { path: string }) => {
        seen.publish = pkg.path;
        return Promise.resolve({ status: 'published' as const });
      }),
    });
    await publish({ cwd: CWD, handlerFor: () => handler });

    // Anchored to opts.cwd and ending in the package subdir — separator-
    // agnostic so the assertion holds on Windows too.
    expect(seen.writeVersion).toMatch(/[/\\]packages[/\\]ts$/);
    expect(seen.publish).toMatch(/[/\\]packages[/\\]ts$/);
  });
});
