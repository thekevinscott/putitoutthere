/**
 * `advanceV0` — force-move the floating `v0` tag to HEAD (#446).
 *
 * The git collaborators (`headCommit`, `forceMoveTag`) are mocked so this
 * isolates the derive-target / log / delegate sequence; stdout is captured
 * for the log-line assertion. The real git + bare-remote round trip (the tag
 * actually landing on local + remote) is covered by
 * tests/integration/tag-plumbing.integration.test.ts and the e2e tier.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { advanceV0 } from './advance-v0.js';
import { forceMoveTag } from './force-move-tag.js';
import { headCommit } from './git.js';

vi.mock('./git.js');
vi.mock('./force-move-tag.js');

const headMock = vi.mocked(headCommit);
const forceMoveMock = vi.mocked(forceMoveTag);
const out: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('advanceV0', () => {
  it('force-moves v0 to HEAD, logging the move', async () => {
    headMock.mockResolvedValue('headsha');

    const code = await advanceV0({ cwd: 'repo' });

    expect(code).toBe(0);
    expect(out.join('')).toBe('Moving v0 -> headsha\n');
    expect(forceMoveMock).toHaveBeenCalledWith('v0', 'headsha', { cwd: 'repo' });
  });
});
