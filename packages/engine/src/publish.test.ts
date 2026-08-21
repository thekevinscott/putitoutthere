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
import { ExecError } from './utils/exec-error.js';
import { dumpFailure } from './verbose.js';

vi.mock('./config.js');
vi.mock('./plan.js');
vi.mock('./preflight.js');
vi.mock('./completeness.js');
vi.mock('./normalize-artifacts.js');
vi.mock('./ensure-tag.js');
vi.mock('./git.js');
vi.mock('./verbose.js');
// The dump recognises the seam's error by `instanceof`, so a substitute
// class would make the assertions below vacuous — declare the mock, resolve
// it to the real module.
vi.mock('./utils/exec-error.js', async () => await vi.importActual<typeof import('./utils/exec-error.js')>('./utils/exec-error.js'));
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
  vi.mocked(loadConfig).mockResolvedValue({
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
  vi.mocked(checkCompleteness).mockResolvedValue(
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
  vi.mocked(headCommit).mockResolvedValue('HEAD-SHA');
  vi.mocked(normalizeArtifactLayout).mockResolvedValue(undefined);
  vi.mocked(readHandlerMeta).mockReturnValue(undefined);
  // Preflight gates pass by default; individual tests override one to abort.
  // requireAuth is the only synchronous preflight gate.
  vi.mocked(requireAuth).mockReturnValue(undefined);
  // Async gates.
  for (const gate of [
    requireProvenanceMetadata,
    requireCratesMetadata,
    requirePypiVersionSource,
    requirePyprojectShape,
    requirePackageJsonShape,
    requireRepoUrlMatch,
    requireCargoShape,
    requireRepoPublic,
  ]) {
    vi.mocked(gate).mockResolvedValue(undefined);
  }
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
    // The cargo-shape pre-flight and the HEAD read must both be threaded
    // the caller's `cwd` (pins the `{ cwd }` options object against `{}`):
    //   requireCargoShape(pkgs, { cwd }) — publish.ts:152
    //   headCommit({ cwd })              — publish.ts:192
    expect(vi.mocked(requireCargoShape)).toHaveBeenCalledWith(expect.anything(), { cwd: CWD });
    expect(vi.mocked(headCommit)).toHaveBeenCalledWith({ cwd: CWD });
    expect(result.ok).toBe(true);
    expect(result.published.map((r) => r.package)).toEqual(['lib-js']);
  });

  it('surfaces each published package tag from its tag_format (#461)', async () => {
    // The CLI reads `published[].tag` to emit `released_packages` to
    // $GITHUB_OUTPUT; publish() must render it via the package's
    // `tag_format` so no caller reconstructs the tag. Custom template
    // here proves it's the config's format, not a hard-coded shape.
    const p = { ...npmPkg('lib-js', 'packages/ts'), tag_format: 'v{version}' };
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    const result = await publish({ cwd: CWD, handlerFor: () => makeHandler() });

    expect(result.published).toEqual([
      expect.objectContaining({ package: 'lib-js', version: '0.1.0', tag: 'v0.1.0' }),
    ]);
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
    // The auto-heal tag write (publish.ts:223) must thread `{ cwd }` as its
    // 5th positional arg — pins the options object against the `{}` mutant
    // on the skip branch (distinct from the success-path ensureTag at :236,
    // asserted by the happy-path test).
    expect(ensureTag).toHaveBeenCalledWith(
      '{name}-v{version}',
      'lib-js',
      '0.1.0',
      'HEAD-SHA',
      { cwd: CWD },
      expect.anything(),
    );
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

  it('runs the auth pre-flight against the packages resolved by name from config', async () => {
    // publish resolves each planned package name back to its config object
    // through the seeded by-name index:
    //   `[...perPackage.keys()].map((name) => mustGet(byName, name))`.
    // Assert the resolved objects reach requireAuth so that mapping is
    // pinned — an empty spread (`[...keys] -> []`) would call requireAuth
    // with [], and a per-name arrow that drops its result (`(name) => … ->
    // () => undefined`) would call it with [undefined, undefined].
    const a = npmPkg('lib-a', 'packages/a');
    const b = npmPkg('lib-b', 'packages/b');
    configWith(a, b);
    vi.mocked(plan).mockResolvedValue([row(a), row(b)]);
    allComplete(a, b);

    await publish({ cwd: CWD, handlerFor: () => makeHandler() });

    expect(requireAuth).toHaveBeenCalledWith([a, b]);
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
    vi.mocked(checkCompleteness).mockResolvedValue(
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

describe('publish: writeVersion hands its manifests to publish (#639)', () => {
  it("threads the written manifests through as the publish ctx's managedManifestPaths", async () => {
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    // A crate that inherits its version has its bump land in the workspace
    // root's Cargo.toml — outside the package directory. The crates
    // handler's pre-publish dirty-tree guard refuses on any dirty file it
    // does not recognize as managed, so unless `publish` forwards what
    // `writeVersion` actually wrote, the fix for #639 turns a corrupted
    // manifest into a refused release.
    const written = ['/repo/Cargo.toml', '/repo/packages/rust/Cargo.toml'];
    const handler = makeHandler({ writeVersion: vi.fn().mockResolvedValue(written) });
    await publish({ cwd: CWD, handlerFor: () => handler });

    expect(handler.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ managedManifestPaths: written }),
    );
  });

  it('forwards an empty list rather than dropping the key when nothing was written', async () => {
    // The guard distinguishes "no managed manifests" from "not told", and
    // both must reach it as data rather than as an absent property that a
    // later default could silently widen.
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    const handler = makeHandler();
    await publish({ cwd: CWD, handlerFor: () => handler });

    expect(handler.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ managedManifestPaths: [] }),
    );
  });

  it('leaves the rest of the ctx intact alongside the added key', async () => {
    // `publish` builds the publish-time ctx by spreading the original; a
    // rebuild that forgot a field would strip the artifacts root or the
    // sibling paths the same guard also reads.
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);

    const handler = makeHandler();
    await publish({ cwd: CWD, handlerFor: () => handler });

    const ctx = vi.mocked(handler.publish).mock.calls[0]![2];
    expect(ctx.cwd).toBe(CWD);
    expect(typeof ctx.artifactsRoot).toBe('string');
    expect(Array.isArray(ctx.siblingPackagePaths)).toBe(true);
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

  it('orders only the selected set, dropping a dependency that is not planned', async () => {
    // `b` depends on `a`, but only `b` is planned. publishOrder seeds its
    // `deps` map for the selected set and filters each package's
    // depends_on down to it, so `b`'s child-deps are empty and the
    // toposort's seeded lookup visits only `b` — it never reaches the
    // unselected `a`.
    const a = npmPkg('a', 'packages/a');
    const b = npmPkg('b', 'packages/b', ['a']);
    configWith(a, b);
    vi.mocked(plan).mockResolvedValue([row(b)]);
    allComplete(b);

    const calls: string[] = [];
    const handler = makeHandler({
      publish: vi.fn().mockImplementation((pkg: { name: string }) => {
        calls.push(pkg.name);
        return Promise.resolve({ status: 'published' as const });
      }),
    });
    const result = await publish({ cwd: CWD, handlerFor: () => handler });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['b']);
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

describe('publish: the failure dump describes the subprocess (#617)', () => {
  // A handler catches the process seam's ExecError and rethrows a rendered
  // message with it as `cause`. The dump used to be reconstructed from that
  // message, so it reported an empty command, an empty stdout and exit code
  // -1 — and replaced the tool's own stderr with our paraphrase of it. That
  // is what made #617 a four-run diagnosis: the evidence that would have
  // shown the paraphrase was wrong had already been thrown away.

  /** The FailureContext `publish` handed `dumpFailure`. */
  function dumpedContext(): Record<string, unknown> {
    const [, ctx] = vi.mocked(dumpFailure).mock.calls[0]!;
    return ctx as unknown as Record<string, unknown>;
  }

  async function failWith(err: Error): Promise<void> {
    const p = npmPkg('lib-js', 'packages/ts');
    configWith(p);
    vi.mocked(plan).mockResolvedValue([row(p)]);
    allComplete(p);
    const handler = makeHandler({ publish: vi.fn().mockRejectedValue(err) });
    await expect(publish({ cwd: CWD, handlerFor: () => handler })).rejects.toThrow();
  }

  const execError = (): ExecError =>
    new ExecError('Command failed: npm publish', 'packed 12 files', 'npm error code E403', 7, {
      command: ['npm', 'publish', '--access=public'],
    });

  it('reports the argv, exit status, stdout and stderr of the failing command', async () => {
    await failWith(new Error('npm publish failed', { cause: execError() }));
    expect(dumpedContext()).toMatchObject({
      command: ['npm', 'publish', '--access=public'],
      stdout: 'packed 12 files',
      stderr: 'npm error code E403',
      exitCode: 7,
    });
  });

  it('finds the ExecError however deep the handler wrapped it', async () => {
    // Handlers wrap once today; a future one that adds context around its
    // own error must not silently drop the dump back to placeholders.
    const inner = new Error('npm publish failed', { cause: execError() });
    await failWith(new Error('publishing lib-js failed', { cause: inner }));
    expect(dumpedContext()).toMatchObject({ exitCode: 7, stderr: 'npm error code E403' });
  });

  it('falls back to the rendered message when no subprocess is behind the failure', async () => {
    // A preflight rejection or a config error has no argv, no streams and no
    // exit status. The sentinel is the honest answer there — and it must be
    // -1, the value the renderer and every log consumer already reads as
    // "not a process exit".
    await failWith(new Error('PIOT_NPM_MISSING_REPOSITORY: package.json has no repository'));
    expect(dumpedContext()).toEqual(
      expect.objectContaining({
        command: [],
        stdout: '',
        stderr: 'PIOT_NPM_MISSING_REPOSITORY: package.json has no repository',
        exitCode: -1,
      }),
    );
  });

  it('reports an empty exit status as the sentinel, not as a zero', async () => {
    // `status` is null when the child was killed by a signal or never
    // spawned. Zero would read as success in a run log.
    const spawnFailure = new ExecError('spawn npm ENOENT', '', '', null, { command: ['npm'] });
    await failWith(new Error('npm publish failed', { cause: spawnFailure }));
    expect(dumpedContext()).toMatchObject({ command: ['npm'], exitCode: -1 });
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
