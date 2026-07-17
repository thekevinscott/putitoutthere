/**
 * CLI wiring for the `release-github` command (#444): dispatch routes to
 * the engine with the parsed `--cwd`, and the engine's exit code is passed
 * through. Isolated per the unit-suite convention: the engine
 * (`./release-github/index.js`) is bare-automocked so the double can't
 * drift from the source, and the dispatcher under test (`./cli.js`) is
 * loaded via dynamic import so the mock is in place first. This asserts
 * routing, not engine behavior (covered in `release-github/index.test.ts`
 * and the e2e-cli tier).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./release-github/index.js');

import { releaseGithub } from './release-github/index.js';

const releaseGithubMock = vi.mocked(releaseGithub);

beforeEach(() => {
  releaseGithubMock.mockReset().mockResolvedValue(0);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('run: release-github dispatch', () => {
  it('routes `release-github` to the engine with the parsed --cwd', async () => {
    const { run } = await import('./cli.js');
    const code = await run(['node', 'piot', 'release-github', '--cwd', '/x']);
    expect(code).toBe(0);
    expect(releaseGithubMock).toHaveBeenCalledWith({ cwd: '/x' });
  });

  it('passes the engine exit code through', async () => {
    releaseGithubMock.mockResolvedValue(0);
    const { run } = await import('./cli.js');
    const code = await run(['node', 'piot', 'release-github', '--cwd', '/x']);
    expect(code).toBe(0);
  });
});
