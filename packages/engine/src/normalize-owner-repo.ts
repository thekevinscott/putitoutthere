import { parseOwnerRepo } from './parse-owner-repo.js';

export function normalizeOwnerRepo(value: string | undefined): string | null {
  if (value === undefined) {return null;}
  const trimmed = value.trim();
  if (trimmed.length === 0) {return null;}
  // Tolerate accidental wrapping (e.g. `https://github.com/owner/repo`
  // landed in the GITHUB_REPOSITORY env var by misconfiguration); the
  // GHA-provided value is always `owner/repo` so this is defence in
  // depth, not a documented surface.
  const slugMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  if (slugMatch) {
    return `${slugMatch[1]}/${slugMatch[2]}`;
  }
  return parseOwnerRepo(trimmed);
}
