/**
 * `reconcile` unit coverage. The subject backfills the missing git tag
 * for every package that is live on its registry but untagged
 * (`status`'s `published, untagged` drift).
 *
 * Its collaborators are isolated: `loadConfig`, `computeStatus`,
 * `resolveTagCommit`, and `ensureTag` are automocked and driven per
 * scenario, so each case exercises the reconcile loop — which drift rows
 * it heals, the sibling-vs-HEAD commit it tags, and the dry-run gate —
 * without a real repo or registry. The pure `formatTag` math runs for
 * real. End-to-end behaviour (real git tag writes + CLI rendering) is
 * pinned at the integration + e2e tiers.
 *
 * Issue #410, #403 slice 3.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from './config.js';
import { loadConfig } from './config.js';
import { ensureTag } from './ensure-tag.js';
import { reconcile } from './reconcile.js';
import { resolveTagCommit } from './resolve-tag-commit.js';
import { computeStatus } from './status.js';
import type { StatusRow } from './status-types.js';

vi.mock('./config.js');
vi.mock('./ensure-tag.js');
vi.mock('./resolve-tag-commit.js');
vi.mock('./status.js');

beforeEach(() => {
  vi.clearAllMocks();
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
  vi.mocked(loadConfig).mockReturnValue({
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
