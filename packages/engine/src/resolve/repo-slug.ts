// The #153 key is repo-qualified from the resolver's own package.json
// repository.url — not GITHUB_REPOSITORY, so the key is identical no
// matter where resolve runs.
export function repoSlugFromRepositoryUrl(url: string): string {
  // Function-scoped so the mutation gate can switch the regex per test
  // run; a module-level initializer evaluates before a mutant activates
  // and false-survives.
  const match = /github\.com[/:]([^/:]+)\/([^/:]+?)(?:\.git)?\/?$/.exec(url);
  if (match === null) {
    throw new Error(`resolve: cannot derive owner/repo from repository.url: ${url}`);
  }
  return `${match[1]}/${match[2]}`;
}
