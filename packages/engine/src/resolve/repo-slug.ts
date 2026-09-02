// The #153 key is repo-qualified from the resolver's own package.json
// repository.url — not GITHUB_REPOSITORY, so the key is identical no
// matter where resolve runs.
const GITHUB_REPO_URL = /github\.com[/:]([^/:]+)\/([^/:]+?)(?:\.git)?\/?$/;

export function repoSlugFromRepositoryUrl(url: string): string {
  const match = GITHUB_REPO_URL.exec(url);
  if (match === null) {
    throw new Error(`resolve: cannot derive owner/repo from repository.url: ${url}`);
  }
  return `${match[1]}/${match[2]}`;
}
