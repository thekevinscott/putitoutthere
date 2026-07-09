/**
 * CLI wiring for the `release-github` command (#444): dispatch routes to
 * the engine with the parsed `--cwd`, and the engine's exit code is passed
 * through. The engine is mocked — this asserts routing, not its behavior
 * (covered in `release-github/index.test.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./release-github/index.js', () => ({ releaseGithub: vi.fn().mockReturnValue(0) }));

import { run } from './cli.js';
import { releaseGithub } from './release-github/index.js';

const releaseGithubMock = vi.mocked(releaseGithub);

beforeEach(() => {
  releaseGithubMock.mockReset().mockReturnValue(0);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('run: release-github dispatch', () => {
  it('routes `release-github` to the engine with the parsed --cwd', async () => {
    const code = await run(['node', 'piot', 'release-github', '--cwd', '/x']);
    expect(code).toBe(0);
    expect(releaseGithubMock).toHaveBeenCalledWith({ cwd: '/x' });
  });

  it('passes the engine exit code through', async () => {
    releaseGithubMock.mockReturnValue(0);
    const code = await run(['node', 'piot', 'release-github', '--cwd', '/x']);
    expect(code).toBe(0);
  });
});
