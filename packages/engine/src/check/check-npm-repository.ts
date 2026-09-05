import type { Package } from '../config.js';
import { ErrorCodes } from '../error-codes.js';
import { checkProvenanceMetadata } from '../preflight.js';
import type { CheckFinding } from './check-types.js';

export async function checkNpmRepository(packages: readonly Package[], findings: CheckFinding[]): Promise<void> {
  for (const f of await checkProvenanceMetadata(packages)) {
    const reason =
      f.reason === 'missing'
        ? `${f.packageJsonPath} not found`
        : `${f.packageJsonPath} has missing or empty \`repository\``;
    findings.push({
      package: f.package,
      message: `[${ErrorCodes.NPM_MISSING_REPOSITORY}] ${reason}. \`npm publish --provenance\` hard-requires a non-empty repository.url.`,
    });
  }
}
