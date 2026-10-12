import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkRepoPublic } from './check-repo-public.js';
import { requireRepoPublic } from './require-repo-public.js';

vi.mock('./check-repo-public.js');

const checkMock = vi.mocked(checkRepoPublic);
const options = { githubRepository: 'acme/widget', githubToken: 't' };

async function thrownLines(): Promise<string[]> {
  try {
    await requireRepoPublic(options);
  } catch (err) {
    return (err as Error).message.split('\n');
  }
  throw new Error('expected requireRepoPublic to throw');
}

beforeEach(() => {
  checkMock.mockReset();
});

describe('requireRepoPublic', () => {
  it('returns silently when the check finds nothing', async () => {
    checkMock.mockResolvedValue(null);
    await expect(requireRepoPublic(options)).resolves.toBeUndefined();
    expect(checkMock).toHaveBeenCalledWith(options);
  });

  it('defaults to empty options', async () => {
    checkMock.mockResolvedValue(null);
    await requireRepoPublic();
    expect(checkMock).toHaveBeenCalledWith({});
  });

  it('throws PIOT_REPO_PRIVATE naming the repo and the explicit-private reason', async () => {
    checkMock.mockResolvedValue({ githubRepository: 'acme/widget', reason: 'private' });
    expect(await thrownLines()).toEqual([
      '[PIOT_REPO_PRIVATE] refusing to publish from a private GitHub repository (acme/widget).',
      '',
      'The GitHub API reports this repository as private.',
      '',
      'Why: npm provenance attestations embed a public source-ref pointer that',
      'consumers cannot dereference on a private repo, and the same source-visibility',
      'expectation underpins the trusted-publisher story across the registries we',
      'publish to. Publishing from a private repo silently degrades every consumer\'s',
      'ability to verify the artifact.',
      '',
      'Fix: make the repository public before publishing, or unset the release',
      'trigger until visibility flips. See',
      '  https://thekevinscott.github.io/putitoutthere/guide/public-repo',
      'for the trusted-publisher rationale and the registry-specific failure modes',
      'this check exists to prevent.',
    ]);
  });

  it('distinguishes the 404 path from the explicit-private path', async () => {
    checkMock.mockResolvedValue({ githubRepository: 'acme/widget', reason: 'not-found-or-private' });
    expect((await thrownLines())[2]).toBe(
      'The GitHub API returned 404 for this repository slug — either the repo is private and the configured token lacks access, or the slug does not exist.',
    );
  });
});
