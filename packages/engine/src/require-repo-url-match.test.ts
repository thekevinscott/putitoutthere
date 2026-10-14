import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from './config.js';
import { checkRepoUrlMatch } from './check-repo-url-match.js';
import { requireRepoUrlMatch } from './require-repo-url-match.js';

vi.mock('./check-repo-url-match.js');

const checkMock = vi.mocked(checkRepoUrlMatch);
const packages = [{ name: 'web', kind: 'npm' }] as unknown as readonly Package[];
const options = { githubRepository: 'acme/widget' };

async function thrownMessage(): Promise<string> {
  try {
    await requireRepoUrlMatch(packages, options);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected requireRepoUrlMatch to throw');
}

beforeEach(() => {
  checkMock.mockReset();
});

describe('requireRepoUrlMatch', () => {
  it('returns silently when the check finds nothing', async () => {
    checkMock.mockResolvedValue([]);
    await expect(requireRepoUrlMatch(packages, options)).resolves.toBeUndefined();
    expect(checkMock).toHaveBeenCalledWith(packages, options);
  });

  it('defaults the options to an empty object', async () => {
    checkMock.mockResolvedValue([]);
    await requireRepoUrlMatch(packages);
    expect(checkMock).toHaveBeenCalledWith(packages, {});
  });

  it('names the declared and expected owner/repo for every failing package', async () => {
    checkMock.mockResolvedValue([
      {
        package: 'a',
        manifestPath: 'a/package.json',
        declaredOwnerRepo: 'wrong/repo',
        expectedOwnerRepo: 'acme/widget',
        declaredUrl: 'git+https://github.com/wrong/repo.git',
      },
    ]);
    expect((await thrownMessage()).split('\n')).toEqual([
      '[PIOT_REPO_URL_MISMATCH] manifest repository URL does not match GITHUB_REPOSITORY.',
      '',
      'Failing packages:',
      '  - a: a/package.json',
      '      declared:  wrong/repo  (git+https://github.com/wrong/repo.git)',
      '      expected:  acme/widget  (from GITHUB_REPOSITORY)',
      '',
      'Why: npm verifies `package.json#repository.url` against the OIDC source claim',
      'before accepting a `--provenance` publish and rejects mismatches with a 422',
      'after the artifact has already been uploaded. crates.io and PyPI carry the same',
      'risk on their trusted-publisher paths.',
      '',
      'Fix: either update the manifest URL to match the GitHub repository this workflow',
      'is running from, or rename the GitHub repository so the slugs line up. Run the',
      'release again once the manifest and the repo agree.',
      '',
      'See https://thekevinscott.github.io/putitoutthere/guide/repository-url.',
    ]);
  });
});
