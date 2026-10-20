/**
 * Heuristic match on npm's auth-related stderr shapes. `E404` belongs here:
 * npm answers an unauthorized publish with not-found, not 401/403, since
 * confirming a package exists but is unwritable is itself disclosure. The
 * ambiguity is the caller's to resolve, not this predicate's (#598).
 */
export function looksLikeAuthFailure(stderr: string | undefined): stderr is string {
  return Boolean(
    stderr?.match(/\b(E401|E403|E404|ENEEDAUTH|EAUTH|need auth|not authori[sz]ed|unauthorized|forbidden)\b/i),
  );
}
