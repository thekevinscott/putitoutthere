import type { Package } from './config.js';
import { checkAuth } from './preflight.js';

export function requireAuth(packages: readonly Package[]): void {
  const status = checkAuth(packages);
  if (status.ok) {return;}
  const missing = status.results.filter((r) => r.via === 'missing');
  const lines = missing.map((r) => {
    const vars = r.acceptedEnvVars.join(' or ');
    return `  - ${r.package} (${r.kind}) needs ${vars} (or OIDC via ACTIONS_ID_TOKEN_REQUEST_TOKEN)`;
  });
  throw new Error(
    [
      'Pre-flight auth check failed:',
      ...lines,
      '',
      `Wire the missing env vars in .github/workflows/release.yml under the publish job.`,
      // The published auth guide, not internal plan docs (#144).
      'See https://thekevinscott.github.io/putitoutthere/guide/auth.',
    ].join('\n'),
  );
}
