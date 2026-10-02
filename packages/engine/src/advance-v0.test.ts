/**
 * `advanceV0` — force-move the floating `v0` tag to HEAD (#446).
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
    expect(headMock).toHaveBeenCalledWith({ cwd: 'repo' });
    expect(forceMoveMock).toHaveBeenCalledWith('v0', 'headsha', { cwd: 'repo' });
  });
});
