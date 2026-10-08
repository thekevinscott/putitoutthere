// Recognises the canonical GitHub URL shapes the npm / cargo / hatch
// ecosystems serialise into manifests:
//   - git+https://github.com/owner/repo(.git)?
//   - https://github.com/owner/repo(.git)?(/)?
//   - http://github.com/owner/repo(.git)?(/)?
//   - git@github.com:owner/repo(.git)?
//   - ssh://git@github.com/owner/repo(.git)?
// Non-github hosts return null; the check skips those packages rather
// than false-positive on legitimately-hosted forks (provenance still
// catches them at publish time).
export function parseOwnerRepo(url: string): string | null {
  const stripped = url.trim().replace(/^git\+/i, '');
  const match = stripped.match(
    /github\.com[/:]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/,
  );
  if (match === null) {return null;}
  return `${match[1]}/${match[2]}`;
}
