import type { Package } from './config.js';
import { ErrorCodes } from './error-codes.js';
import { checkRepoUrlMatch, type RepoUrlMatchOptions } from './preflight.js';

export async function requireRepoUrlMatch(
  packages: readonly Package[],
  options: RepoUrlMatchOptions = {},
): Promise<void> {
  const findings = await checkRepoUrlMatch(packages, options);
  if (findings.length === 0) {return;}
  const lines: string[] = [
    `[${ErrorCodes.REPO_URL_MISMATCH}] manifest repository URL does not match GITHUB_REPOSITORY.`,
    '',
    'Failing packages:',
  ];
  for (const f of findings) {
    lines.push(
      `  - ${f.package}: ${f.manifestPath}`,
      `      declared:  ${f.declaredOwnerRepo}  (${f.declaredUrl})`,
      `      expected:  ${f.expectedOwnerRepo}  (from GITHUB_REPOSITORY)`,
    );
  }
  lines.push(
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
  );
  throw new Error(lines.join('\n'));
}
