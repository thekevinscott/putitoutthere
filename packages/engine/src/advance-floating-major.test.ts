/**
 * `advanceFloatingMajor` — move the floating `v<major>` tag to the newest
 * release in its major line (#446).
 *
 * The config loader and git collaborators (`loadConfig`, `fetchTagsForce`,
 * `lastTag`, `tagCommit`, `tagList`, `forceMoveTag`) are mocked so this
 * isolates the three branches — move, idempotent "already at" no-op, and
 * "no release tag yet" no-op — with stdout captured for the log lines. The
 * real semver selection lives in `lastTag` (see git.test.ts) and the real
 * git round trip in tests/integration/tag-plumbing.integration.test.ts + the
 * e2e tier. `parseTagVersion` (pure) runs for real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { advanceFloatingMajor } from './advance-floating-major.js';
import { loadConfig } from './config.js';
import { forceMoveTag } from './force-move-tag.js';
import { fetchTagsForce, lastTag, tagCommit, tagList } from './git.js';

vi.mock('./config.js');
vi.mock('./git.js');
vi.mock('./force-move-tag.js');

const loadConfigMock = vi.mocked(loadConfig);
const lastTagMock = vi.mocked(lastTag);
const tagCommitMock = vi.mocked(tagCommit);
const tagListMock = vi.mocked(tagList);
const forceMoveMock = vi.mocked(forceMoveTag);
const fetchTagsMock = vi.mocked(fetchTagsForce);
const out: string[] = [];

// The single package the floating-major mover tracks. Only the fields the
// resolver reads are supplied.
function config(): ReturnType<typeof loadConfig> {
  return {
    packages: [{ name: 'putitoutthere', tag_format: '{name}-v{version}' }],
  } as unknown as ReturnType<typeof loadConfig>;
}

beforeEach(() => {
  vi.resetAllMocks();
  loadConfigMock.mockReturnValue(config());
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('advanceFloatingMajor', () => {
  it('moves v<major> to the newest release commit, logging the move', async () => {
    lastTagMock.mockResolvedValue('putitoutthere-v0.2.0');
    tagCommitMock.mockResolvedValue('targetsha');
    tagListMock.mockResolvedValue([]); // no existing floating tag yet

    const code = await advanceFloatingMajor({ cwd: 'repo' });

    expect(code).toBe(0);
    // The remote tags are refreshed before "latest release" is re-derived.
    expect(fetchTagsMock).toHaveBeenCalledWith({ cwd: 'repo' });
    expect(out.join('')).toBe(
      'Moving floating tag v0 -> targetsha (latest release putitoutthere-v0.2.0)\n',
    );
    expect(forceMoveMock).toHaveBeenCalledWith('v0', 'targetsha', { cwd: 'repo' });
  });

  it('derives the floating tag from the major of the release lastTag selected', async () => {
    // lastTag owns the highest-semver selection (git.test.ts covers it); this
    // pins that a v1.10.0 release drives the `v1` floating tag, not `v1.2`.
    lastTagMock.mockResolvedValue('putitoutthere-v1.10.0');
    tagCommitMock.mockResolvedValue('targetsha');
    tagListMock.mockResolvedValue([]);

    await advanceFloatingMajor({ cwd: 'repo' });

    expect(out.join('')).toContain('latest release putitoutthere-v1.10.0');
    expect(forceMoveMock).toHaveBeenCalledWith('v1', 'targetsha', { cwd: 'repo' });
  });

  it('is idempotent: reports no update when the floating tag already matches', async () => {
    lastTagMock.mockResolvedValue('putitoutthere-v2.0.0');
    // Both the release tag and the existing floating tag point at the same
    // commit, so no move is issued.
    tagCommitMock.mockResolvedValue('samesha');
    tagListMock.mockResolvedValue(['v2']);

    const code = await advanceFloatingMajor({ cwd: 'repo' });

    expect(code).toBe(0);
    expect(out.join('')).toBe('Floating tag v2 already at putitoutthere-v2.0.0; no update.\n');
    expect(forceMoveMock).not.toHaveBeenCalled();
  });

  it('no-ops with a message when no release tag exists yet', async () => {
    lastTagMock.mockResolvedValue(null);

    const code = await advanceFloatingMajor({ cwd: 'repo' });

    expect(code).toBe(0);
    expect(out.join('')).toBe('No putitoutthere-v* tags yet; nothing to track.\n');
    expect(forceMoveMock).not.toHaveBeenCalled();
  });
});
