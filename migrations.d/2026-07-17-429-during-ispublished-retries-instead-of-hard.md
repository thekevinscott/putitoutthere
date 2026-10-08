# 429 during `isPublished` retries instead of hard-failing

**Summary.** A `429 Too Many Requests` from crates.io or PyPI during the
pre-publish existence check (`isPublished`) is now treated as transient and
retried, instead of hard-failing the publish. crates.io and PyPI rate-limit
routine reads; the release path already wraps `isPublished` in `withRetry`,
but the handlers classified a 429 as the plain-`Error` fallthrough (not
`>= 500`), and that error carried no `status` property for the retry layer to
recognize — so a single throttled read aborted an otherwise-healthy release.
Both handlers now raise a `TransientError` for 429 alongside 5xx (issue #580).

**Required changes.** None. This is internal engine behavior; no config,
CLI flag, or workflow input changes.

**Deprecations removed.** None.

**Behavior changes without code changes.** A 429 returned by crates.io or
PyPI during the pre-publish `isPublished` check is now retried with backoff
(the same `withRetry` policy already applied to 5xx) rather than surfacing as
an immediate publish failure. Non-429 4xx responses (400/401/403/…) are
unchanged: still a hard, non-retryable error. npm is unaffected — its
`isPublished` shells out to `npm view` and already tolerates any non-zero
exit as "not published."

**Verification.** A release run that hits a transient rate-limit during the
existence check now completes instead of failing; no consumer-side change is
needed to observe it.
