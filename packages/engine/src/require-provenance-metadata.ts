import type { Package } from './config.js';
import { ErrorCodes } from './error-codes.js';
import { checkProvenanceMetadata } from './check-provenance-metadata.js';

/**
 * Throw with an actionable error when any npm package's `package.json`
 * lacks a non-empty `repository` field. Reports every failing package
 * in one error rather than failing on the first, so consumers fix
 * them all in one round-trip.
 *
 * Always runs (not OIDC-gated): the README demands the field for
 * every npm publish, and `npm publish --provenance` is putitoutthere's
 * blessed publish mode. Even on the token path, missing `repository`
 * is a misconfiguration — fail fast.
 */
export async function requireProvenanceMetadata(packages: readonly Package[]): Promise<void> {
  const findings = await checkProvenanceMetadata(packages);
  if (findings.length === 0) {return;}
  const lines: string[] = [
    `[${ErrorCodes.NPM_MISSING_REPOSITORY}] npm publish requires a non-empty \`repository\` field in package.json.`,
    '',
    'Failing packages:',
  ];
  for (const f of findings) {
    lines.push(`  - ${f.package}: ${f.packageJsonPath} (${f.reason})`);
  }
  lines.push(
    '',
    'Why: `npm publish --provenance` (used by putitoutthere on the OIDC trusted-publisher',
    'path) hard-requires this field so npm can verify the package was built from the repo',
    'the trusted publisher declares.',
    '',
    'Fix: add a `repository` block to each failing package.json. Canonical shape:',
    '',
    '  {',
    '    "repository": {',
    '      "type": "git",',
    '      "url": "git+https://github.com/<owner>/<repo>.git",',
    '      "directory": "<path/to/package>"',
    '    }',
    '  }',
    '',
    'See https://github.com/thekevinscott/putitoutthere#kind--npm.',
  );
  throw new Error(lines.join('\n'));
}
