import { checkRepoPublic, type RepoVisibilityOptions } from './check-repo-public.js';
import { ErrorCodes } from './error-codes.js';

export async function requireRepoPublic(
  options: RepoVisibilityOptions = {},
): Promise<void> {
  const finding = await checkRepoPublic(options);
  if (finding === null) {return;}
  const lines: string[] = [
    `[${ErrorCodes.REPO_PRIVATE}] refusing to publish from a private GitHub repository (${finding.githubRepository}).`,
    '',
    finding.reason === 'private'
      ? 'The GitHub API reports this repository as private.'
      : 'The GitHub API returned 404 for this repository slug — either the repo is private and the configured token lacks access, or the slug does not exist.',
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
  ];
  throw new Error(lines.join('\n'));
}
