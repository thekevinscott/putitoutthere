import { stat } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import type { Package } from '../config.js';
import { checkPaths } from './check-paths.js';
import type { CheckFinding } from '../check.js';

vi.mock('node:fs/promises');

const asDir = { isDirectory: () => true } as Awaited<ReturnType<typeof stat>>;
const asFile = { isDirectory: () => false } as Awaited<ReturnType<typeof stat>>;

describe('checkPaths', () => {
  it('accepts a path that exists and is a directory', async () => {
    vi.mocked(stat).mockResolvedValue(asDir);
    const findings: CheckFinding[] = [];
    await checkPaths([{ name: 'rs', path: '/repo/rs' }] as unknown as readonly Package[], findings);
    expect(findings).toEqual([]);
  });

  it('flags a path that does not exist', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'));
    const findings: CheckFinding[] = [];
    await checkPaths([{ name: 'rs', path: '/repo/gone' }] as unknown as readonly Package[], findings);
    expect(findings).toEqual([
      { package: 'rs', message: 'path "/repo/gone" does not exist or is not a directory in the worktree' },
    ]);
  });

  it('flags a path that exists but is a file', async () => {
    vi.mocked(stat).mockResolvedValue(asFile);
    const findings: CheckFinding[] = [];
    await checkPaths([{ name: 'rs', path: '/repo/file' }] as unknown as readonly Package[], findings);
    expect(findings).toEqual([
      { package: 'rs', message: 'path "/repo/file" does not exist or is not a directory in the worktree' },
    ]);
  });
});
