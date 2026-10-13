import type { Package } from './config.js';
import { checkAuth, OIDC_ENV } from './preflight.js';

// Points consumers at the published auth guide, not internal plan docs
// (#144).
const DOCS_POINTER = 'https://thekevinscott.github.io/putitoutthere/guide/auth';

export function requireAuth(packages: readonly Package[]): void {
  const status = checkAuth(packages);
  if (status.ok) {return;}
  const missing = status.results.filter((r) => r.via === 'missing');
  const lines = missing.map((r) => {
    const vars = r.acceptedEnvVars.join(' or ');
    return `  - ${r.package} (${r.kind}) needs ${vars} (or OIDC via ${OIDC_ENV})`;
  });
  throw new Error(
    [
      'Pre-flight auth check failed:',
      ...lines,
      '',
      `Wire the missing env vars in .github/workflows/release.yml under the publish job.`,
      `See ${DOCS_POINTER}.`,
    ].join('\n'),
  );
}
