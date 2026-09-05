import type { Package } from '../config.js';
import { ErrorCodes } from '../error-codes.js';
import { checkRepoUrlMatch } from '../preflight.js';
import type { CheckFinding } from './check-types.js';

export async function checkRepoUrlMatchFindings(
  packages: readonly Package[],
  findings: CheckFinding[],
): Promise<void> {
  // Sourced from GHA's process env at PR time when this runs inside the
  // reusable workflow. Locally invoked `putitoutthere check` outside any
  // GHA context will skip the check (the preflight returns no findings
  // when GITHUB_REPOSITORY is unset), which is the right behaviour:
  // there is no workflow source to disagree with.
  const githubRepository = process.env.GITHUB_REPOSITORY;
  for (const f of await checkRepoUrlMatch(packages, { githubRepository })) {
    findings.push({
      package: f.package,
      message: `[${ErrorCodes.REPO_URL_MISMATCH}] ${f.manifestPath}: declared repository "${f.declaredOwnerRepo}" does not match GITHUB_REPOSITORY "${f.expectedOwnerRepo}". npm rejects \`--provenance\` publishes whose package.json#repository.url disagrees with the OIDC source claim (422); crates.io / PyPI trusted-publisher paths carry the same risk.`,
    });
  }
}
