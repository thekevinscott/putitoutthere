/**
 * `reconcileExpected` unit coverage — the `--expect` arm of reconcile.
 *
 * The contract that matters is negative: this path must never consult a
 * registry's mutable latest-version pointer. It asks `isPublished` about
 * the exact version the caller named (the immutable per-version endpoint)
 * and refuses to tag anything it cannot confirm, which is what stops a
 * CDN-cached pointer from turning a missed tag into a silent exit 0
 * (#666).
 *
 * `handlerFor`, `tagList`, `resolveTagCommit`, and `ensureTag` are
 * automocked so each case exercises the loop — confirm, resolve, tag —
 * without a repo or a registry. `parseReconcileExpect` and `formatTag`
 * stay real; both are pure.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config, Package } from './config.js';
import { ensureTag } from './ensure-tag.js';
import { tagList } from './git.js';
import { handlerFor } from './handlers/index.js';
import { reconcileExpected } from './reconcile-expect.js';
import { resolveTagCommit } from './resolve-tag-commit.js';
import type { Ctx, Handler, Logger, PackageConfig } from './types.js';

vi.mock('./ensure-tag.js');
vi.mock('./git.js');
vi.mock('./handlers/index.js');
vi.mock('./resolve-tag-commit.js');

/** Tags that exist locally; `tagList` is answered from this set. */
const existingTags = new Set<string>();

/** Every (pkg, version) the fake registry will confirm via isPublished. */
const publishedVersions = new Set<string>();

/** Ctx values captured from each isPublished call, in order. */
let seenCtx: Ctx[] = [];

const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  existingTags.clear();
  publishedVersions.clear();
  seenCtx = [];

  vi.mocked(tagList).mockImplementation((name: string) =>
    Promise.resolve(existingTags.has(name) ? [name] : []),
  );
  vi.mocked(handlerFor).mockImplementation((kind) => ({
    kind,
    isPublished: (p: PackageConfig, version: string, ctx: Ctx) => {
      seenCtx.push(ctx);
      return Promise.resolve(publishedVersions.has(`${p.name}@${version}`));
    },
    latestVersion: vi.fn<Handler['latestVersion']>(() => {
      throw new Error('--expect must never read the latest-version pointer');
    }),
    trustPosture: vi.fn().mockResolvedValue('token'),
    writeVersion: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({ status: 'published', url: 'x' }),
  }));
  vi.mocked(resolveTagCommit).mockResolvedValue({ commit: 'release-sha', source: 'sibling' });
});

function pkg(name: string): Package {
  return {
    name,
    kind: 'pypi',
    build: 'hatch',
    path: `packages/${name}`,
    globs: [`packages/${name}/**`],
    depends_on: [],
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
  };
}

function npmPkg(name: string): Package {
  return {
    name,
    kind: 'npm',
    path: `packages/${name}`,
    globs: [`packages/${name}/**`],
    depends_on: [],
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
  };
}

function configOf(...packages: Package[]): {
  config: Config;
  byName: ReadonlyMap<string, Package>;
} {
  return {
    config: { putitoutthere: { version: 1 }, packages },
    byName: new Map(packages.map((p) => [p.name, p])),
  };
}

describe('reconcileExpected', () => {
  it('tags a confirmed version without reading the latest-version pointer', async () => {
    const { config, byName } = configOf(pkg('core-py'));
    publishedVersions.add('core-py@2.0.0');

    const actions = await reconcileExpected('core-py@2.0.0', config, byName, '/repo', false, log);

    expect(actions).toEqual([
      {
        package: 'core-py',
        kind: 'pypi',
        version: '2.0.0',
        tag: 'core-py-v2.0.0',
        commit: 'release-sha',
        source: 'sibling',
        created: true,
      },
    ]);
    expect(handlerFor).toHaveBeenCalledWith('pypi');
    expect(ensureTag).toHaveBeenCalledWith(
      '{name}-v{version}',
      'core-py',
      '2.0.0',
      'release-sha',
      { cwd: '/repo' },
      log,
    );
  });

  it('resolves the tag commit from the siblings, excluding the package itself', async () => {
    const { config, byName } = configOf(pkg('core-py'), pkg('other-py'), pkg('third-py'));
    publishedVersions.add('core-py@2.0.0');

    await reconcileExpected('core-py@2.0.0', config, byName, '/repo', false, log);

    expect(resolveTagCommit).toHaveBeenCalledWith(
      '2.0.0',
      [expect.objectContaining({ name: 'other-py' }), expect.objectContaining({ name: 'third-py' })],
      { cwd: '/repo' },
    );
  });

  it('hands the handler a cwd-scoped ctx with an empty artifact store', async () => {
    const { config, byName } = configOf(pkg('core-py'));
    publishedVersions.add('core-py@2.0.0');

    await reconcileExpected('core-py@2.0.0', config, byName, '/repo', false, log);

    expect(seenCtx).toHaveLength(1);
    const [ctx] = seenCtx;
    expect(ctx?.cwd).toBe('/repo');
    expect(ctx?.log).toBe(log);
    // No build ran on this path, so there are no artifacts to offer.
    expect(ctx?.artifacts.has('any-artifact')).toBe(false);
    expect(ctx?.artifacts.get('any-artifact')).toBe('');
  });

  it('is a no-op for an already-tagged version and never asks the registry', async () => {
    const { config, byName } = configOf(pkg('core-py'));
    existingTags.add('core-py-v2.0.0');

    const actions = await reconcileExpected('core-py@2.0.0', config, byName, '/repo', false, log);

    expect(actions).toEqual([]);
    expect(tagList).toHaveBeenCalledWith('core-py-v2.0.0', { cwd: '/repo' });
    expect(handlerFor).not.toHaveBeenCalled();
    expect(ensureTag).not.toHaveBeenCalled();
  });

  it('fails loudly when the registry cannot confirm the expected version', async () => {
    const { config, byName } = configOf(pkg('core-py'));

    await expect(
      reconcileExpected('core-py@2.0.0', config, byName, '/repo', false, log),
    ).rejects.toThrow('reconcile --expect: core-py@2.0.0 not found on the pypi registry');
    expect(ensureTag).not.toHaveBeenCalled();
  });

  it('fails loudly when the expectation names a package the config does not declare', async () => {
    const { config, byName } = configOf(pkg('core-py'));

    await expect(
      reconcileExpected('ghost-py@2.0.0', config, byName, '/repo', false, log),
    ).rejects.toThrow('reconcile --expect: "ghost-py" is not a package name in putitoutthere.toml');
    expect(handlerFor).not.toHaveBeenCalled();
    expect(ensureTag).not.toHaveBeenCalled();
  });

  it('reports the heal under --dry-run without writing the tag', async () => {
    const { config, byName } = configOf(pkg('core-py'));
    publishedVersions.add('core-py@2.0.0');

    const actions = await reconcileExpected('core-py@2.0.0', config, byName, '/repo', true, log);

    expect(actions).toEqual([expect.objectContaining({ tag: 'core-py-v2.0.0', created: false })]);
    expect(ensureTag).not.toHaveBeenCalled();
  });

  it('confirms every entry of a multi-package expectation, dispatching per kind', async () => {
    const { config, byName } = configOf(pkg('core-py'), npmPkg('core-js'));
    publishedVersions.add('core-py@2.0.0');
    publishedVersions.add('core-js@2.0.0');

    const raw = JSON.stringify([
      { name: 'core-py', version: '2.0.0', tag: 'ignored' },
      { name: 'core-js', version: '2.0.0' },
    ]);
    const actions = await reconcileExpected(raw, config, byName, '/repo', false, log);

    expect(actions.map((a) => a.tag)).toEqual(['core-py-v2.0.0', 'core-js-v2.0.0']);
    expect(handlerFor).toHaveBeenNthCalledWith(1, 'pypi');
    expect(handlerFor).toHaveBeenNthCalledWith(2, 'npm');
    expect(ensureTag).toHaveBeenCalledTimes(2);
  });

  it('stops at the first unconfirmed entry rather than tagging the rest', async () => {
    const { config, byName } = configOf(pkg('core-py'), npmPkg('core-js'));
    publishedVersions.add('core-js@2.0.0');

    const raw = JSON.stringify([
      { name: 'core-py', version: '2.0.0' },
      { name: 'core-js', version: '2.0.0' },
    ]);

    await expect(reconcileExpected(raw, config, byName, '/repo', false, log)).rejects.toThrow(
      /core-py@2\.0\.0 not found/,
    );
    expect(ensureTag).not.toHaveBeenCalled();
  });
});
