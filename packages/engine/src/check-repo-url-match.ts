import type { Package } from './config.js';
import { normalizeOwnerRepo } from './normalize-owner-repo.js';
import { parseOwnerRepo } from './parse-owner-repo.js';
import { readDeclaredRepoUrl } from './read-declared-repo-url.js';

// Catches the manifest-vs-GITHUB_REPOSITORY mismatch that npm's
// provenance verification rejects with a 422 ("repository.url is X,
// expected to match Y from provenance"). Same risk exists on
// crates.io / PyPI trusted-publisher paths against
// Cargo.toml [package].repository and pyproject.toml [project.urls];
// catching all three in the same check keeps the failure modes
// fingerprinted by the same error code.

export interface RepoUrlMatchOptions {
  /** Value of the GitHub Actions `GITHUB_REPOSITORY` env var, format
   *  `owner/repo`. When `undefined` or empty, the check is a no-op
   *  (local CLI runs outside a GHA context can't disagree with a
   *  workflow source). Accepts `undefined` explicitly so callers
   *  reading from `process.env.GITHUB_REPOSITORY` can pass the value
   *  through without a defensive ternary. */
  githubRepository?: string | undefined;
}

export interface RepoUrlMatchFinding {
  package: string;
  /** Pkg-relative manifest file the URL was read from. */
  manifestPath: string;
  /** The normalised `owner/repo` parsed from the manifest URL. */
  declaredOwnerRepo: string;
  /** The `owner/repo` from `GITHUB_REPOSITORY`. */
  expectedOwnerRepo: string;
  /** Verbatim URL as it appears in the manifest, useful for the
   *  remediation message. */
  declaredUrl: string;
}

export async function checkRepoUrlMatch(
  packages: readonly Package[],
  options: RepoUrlMatchOptions = {},
): Promise<RepoUrlMatchFinding[]> {
  const expectedOwnerRepo = normalizeOwnerRepo(options.githubRepository);
  if (expectedOwnerRepo === null) {return [];}
  const findings: RepoUrlMatchFinding[] = [];
  for (const p of packages) {
    const declared = await readDeclaredRepoUrl(p);
    if (declared === null) {continue;}
    const declaredOwnerRepo = parseOwnerRepo(declared.url);
    if (declaredOwnerRepo === null) {continue;}
    if (declaredOwnerRepo.toLowerCase() === expectedOwnerRepo.toLowerCase()) {continue;}
    findings.push({
      package: p.name,
      manifestPath: declared.manifestPath,
      declaredOwnerRepo,
      expectedOwnerRepo,
      declaredUrl: declared.url,
    });
  }
  return findings;
}
