/**
 * `reconcile` unit coverage. The subject backfills the missing git tag
 * for every package whose live registry version has no tag — the
 * `published, untagged` drift, and (since #623) the registry-ahead-of-
 * the-newest-tag drift a caller-side PyPI upload leaves behind.
 *
 * Its collaborators are isolated: `loadConfig`, `computeStatus`,
 * `resolveTagCommit`, `tagList`, and `ensureTag` are automocked and
 * driven per scenario, so each case exercises the reconcile loop — which
 * rows it heals, the sibling-vs-HEAD commit it tags, and the dry-run gate
 * — without a real repo or registry. The pure `formatTag` math runs for
 * real. End-to-end behaviour (real git tag writes + CLI rendering) is
 * pinned at the integration + e2e tiers.
 *
 * Issue #410, #403 slice 3, #623.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from './config.js';
import { loadConfig } from './config.js';
import { ensureTag } from './ensure-tag.js';
import { tagList } from './git.js';
import { reconcile } from './reconcile.js';
import { resolveTagCommit } from './resolve-tag-commit.js';
import { computeStatus } from './status.js';
import type { StatusRow } from './status-types.js';

vi.mock('./config.js');
vi.mock('./ensure-tag.js');
vi.mock('./git.js');
vi.mock('./resolve-tag-commit.js');
vi.mock('./status.js');

/** Tags that exist locally; `tagList` is answered from this set. */
const existingTags = new Set<string>();

beforeEach(() => {
  vi.clearAllMocks();
  existingTags.clear();
  vi.mocked(tagList).mockImplementation((name: string) =>
    Promise.resolve(existingTags.has(name) ? [name] : []),
  );
});

function pkg(name: string): Package {
  return {
    name,
    kind: 'crates',
    crate: name,
    path: `packages/${name}`,
    globs: [`packages/${name}/**`],
    depends_on: [],
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
  };
}

function configWith(...packages: Package[]): void {
  vi.mocked(loadConfig).mockResolvedValue({
    putitoutthere: { version: 1 },
    packages,
  });
}

function statusRow(over: Partial<StatusRow> & { package: string }): StatusRow {
  return {
    kind: 'crates',
    tag: null,
    tagVersion: null,
    registry: null,
    registryUnreachable: false,
    state: 'in sync',
    drift: false,
    ...over,
  };
}

describe('reconcile', () => {
  it('backfills at the sibling tag commit and leaves in-sync packages untouched', async () => {
    configWith(pkg('core-rust'), pkg('other-rust'), pkg('helper-rust'));
    // core is live at 0.1.0 but untagged (drift); the siblings are in sync.
    vi.mocked(computeStatus).mockResolvedValue([
      statusRow({ package: 'core-rust', registry: '0.1.0', state: 'published, untagged', drift: true }),
      statusRow({ package: 'other-rust', tag: 'other-rust-v2.0.0', tagVersion: '2.0.0', registry: '2.0.0', state: 'in sync' }),
      statusRow({ package: 'helper-rust', tag: 'helper-rust-v0.1.0', tagVersion: '0.1.0', registry: '0.1.0', state: 'in sync' }),
    ]);
    existingTags.add('other-rust-v2.0.0');
    existingTags.add('helper-rust-v0.1.0');
    vi.mocked(resolveTagCommit).mockResolvedValue({ commit: 'sibling-sha', source: 'sibling' });

    const result = await reconcile({ cwd: '/repo' });

    // Only the drifting package is healed; siblings produce no action.
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.actions).toEqual([
      {
        package: 'core-rust',
        kind: 'crates',
        version: '0.1.0',
        tag: 'core-rust-v0.1.0',
        commit: 'sibling-sha',
        source: 'sibling',
        created: true,
      },
    ]);

    // The heal used the sibling resolver and wrote the tag once.
    expect(resolveTagCommit).toHaveBeenCalledTimes(1);
    expect(resolveTagCommit).toHaveBeenCalledWith(
      '0.1.0',
      // siblings = every other package
      [expect.objectContaining({ name: 'other-rust' }), expect.objectContaining({ name: 'helper-rust' })],
      { cwd: '/repo' },
    );
    expect(ensureTag).toHaveBeenCalledTimes(1);
    expect(ensureTag).toHaveBeenCalledWith(
      '{name}-v{version}',
      'core-rust',
      '0.1.0',
      'sibling-sha',
      { cwd: '/repo' },
      expect.anything(),
    );
  });

  it('falls back to HEAD when no sibling tag exists', async () => {
    configWith(pkg('core-rust'));
    vi.mocked(computeStatus).mockResolvedValue([
      statusRow({ package: 'core-rust', registry: '0.1.0', state: 'published, untagged', drift: true }),
    ]);
    vi.mocked(resolveTagCommit).mockResolvedValue({ commit: 'head-sha', source: 'head' });

    const result = await reconcile({ cwd: '/repo' });

    expect(result.dryRun).toBe(false);
    expect(result.actions).toEqual([
      expect.objectContaining({
        package: 'core-rust',
        tag: 'core-rust-v0.1.0',
        commit: 'head-sha',
        source: 'head',
        created: true,
      }),
    ]);
    expect(ensureTag).toHaveBeenCalledWith(
      '{name}-v{version}',
      'core-rust',
      '0.1.0',
      'head-sha',
      { cwd: '/repo' },
      expect.anything(),
    );
  });

  it("heals a registry version that is ahead of the package's newest tag (#623)", async () => {
    // The state a delegated PyPI upload leaves: the previous release is
    // tagged, the version the caller-side `pypi-publish` job just
    // uploaded is not. `status` calls that `version mismatch`, not
    // `published, untagged` — reconcile keys on the registry version
    // lacking a tag, so it heals both.
    configWith(pkg('core-py'));
    vi.mocked(computeStatus).mockResolvedValue([
      statusRow({
        package: 'core-py',
        kind: 'pypi',
        tag: 'core-py-v0.0.1',
        tagVersion: '0.0.1',
        registry: '0.0.2',
        state: 'version mismatch',
        drift: true,
      }),
    ]);
    vi.mocked(resolveTagCommit).mockResolvedValue({ commit: 'release-sha', source: 'sibling' });

    const result = await reconcile({ cwd: '/repo' });

    // It asks about the REGISTRY's version, not the newest tag.
    expect(tagList).toHaveBeenCalledWith('core-py-v0.0.2', { cwd: '/repo' });
    expect(ensureTag).toHaveBeenCalledWith(
      '{name}-v{version}',
      'core-py',
      '0.0.2',
      'release-sha',
      { cwd: '/repo' },
      expect.anything(),
    );
    expect(result.actions).toEqual([
      expect.objectContaining({ package: 'core-py', version: '0.0.2', tag: 'core-py-v0.0.2' }),
    ]);
  });

  it('writes nothing when the registry version already has its tag', async () => {
    // A tag AHEAD of the registry (cut, not yet published) reaches the
    // same branch: the registry's own version already carries an older
    // tag, so there is nothing to backfill. This is what keeps #623's
    // widened condition from re-tagging on every drift state.
    configWith(pkg('core-py'));
    vi.mocked(computeStatus).mockResolvedValue([
      statusRow({
        package: 'core-py',
        kind: 'pypi',
        tag: 'core-py-v0.0.2',
        tagVersion: '0.0.2',
        registry: '0.0.1',
        state: 'version mismatch',
        drift: true,
      }),
    ]);
    existingTags.add('core-py-v0.0.1');
    existingTags.add('core-py-v0.0.2');

    const result = await reconcile({ cwd: '/repo' });

    expect(result.actions).toEqual([]);
    expect(resolveTagCommit).not.toHaveBeenCalled();
    expect(ensureTag).not.toHaveBeenCalled();
  });

  it('skips a package that has never been published', async () => {
    // `unreleased` and `tagged, unpublished` name versions that are not
    // on the registry; a tag is not the fix for either.
    configWith(pkg('core-rust'));
    vi.mocked(computeStatus).mockResolvedValue([
      statusRow({ package: 'core-rust', registry: null, state: 'unreleased' }),
    ]);

    const result = await reconcile({ cwd: '/repo' });

    expect(result.actions).toEqual([]);
    expect(tagList).not.toHaveBeenCalled();
    expect(ensureTag).not.toHaveBeenCalled();
  });

  it('skips a package whose registry could not be read', async () => {
    // A registry blip is not evidence that a version shipped. Healing on
    // it would write a tag from a stale read.
    configWith(pkg('core-rust'));
    vi.mocked(computeStatus).mockResolvedValue([
      statusRow({
        package: 'core-rust',
        registry: '0.1.0',
        registryUnreachable: true,
        state: 'registry unreachable',
      }),
    ]);

    const result = await reconcile({ cwd: '/repo' });

    expect(result.actions).toEqual([]);
    expect(ensureTag).not.toHaveBeenCalled();
  });

  it('--dry-run reports the heal without writing a tag', async () => {
    configWith(pkg('core-rust'));
    vi.mocked(computeStatus).mockResolvedValue([
      statusRow({ package: 'core-rust', registry: '0.1.0', state: 'published, untagged', drift: true }),
    ]);
    vi.mocked(resolveTagCommit).mockResolvedValue({ commit: 'head-sha', source: 'head' });

    const result = await reconcile({ cwd: '/repo', dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.actions).toEqual([
      expect.objectContaining({
        package: 'core-rust',
        tag: 'core-rust-v0.1.0',
        created: false,
      }),
    ]);
    // Dry-run must not write the tag.
    expect(ensureTag).not.toHaveBeenCalled();
  });
});
