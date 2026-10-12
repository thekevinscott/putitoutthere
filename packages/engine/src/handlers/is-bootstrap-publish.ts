import { USER_AGENT } from '../version.js';

/**
 * Returns true when the package does not yet exist on the registry
 * (any 404-equivalent from the packument endpoint). Non-404 responses
 * — including network failures and timeouts — return false so we
 * don't misclassify transient errors as the bootstrap case.
 *
 * The fetch is bounded by a 5s AbortSignal.timeout (#142). The hint is
 * advisory: a slow or unreachable registry should fall through to
 * "not a bootstrap publish" rather than hanging the action.
 */
export async function isBootstrapPublish(name: string): Promise<boolean> {
  try {
    // The npm registry expects scoped packages as `@scope%2Fname`: the
    // `@` prefix stays literal, `/` stays percent-encoded. Unscoped
    // names have no `@` at all. `replaceAll` keeps the transform safe
    // against pathological input even though encodeURIComponent can
    // only produce `%40` at the start of a valid npm name.
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name).replaceAll('%40', '@')}`,
      {
        method: 'GET',
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      },
    );
    return res.status === 404;
  } catch {
    // Network failure, timeout, DNS error — treat as "not a bootstrap"
    // so the caller falls through to the generic auth-error message
    // rather than hanging or surfacing a misleading hint.
    return false;
  }
}
