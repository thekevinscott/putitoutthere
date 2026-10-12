import { createHash } from 'node:crypto';

import { scanSource, type EnvSource } from './scan-source.js';

/**
 * Replace every occurrence of a known-secret env value with
 * `[REDACTED:<digest>]` where `<digest>` is a stable 8-hex-char
 * SHA-256 prefix of the token. Operators can correlate rotated
 * tokens across log lines without ever seeing the value itself.
 *
 * Sources default to `[process.env]`. Callers (e.g. `createLogger`)
 * pass additional per-ctx env objects so credentials that never touched
 * `process.env` still redact (#136).
 */
export function redact(
  s: string,
  sources: readonly EnvSource[] = [process.env],
): string {
  let out = s;
  for (const src of sources) {
    for (const v of scanSource(src)) {
      if (!out.includes(v)) {continue;}
      // String.replaceAll expects a literal or a RegExp; use split/join to
      // avoid regex escaping every secret value. Repeats across sources
      // are a no-op (the value's already gone after the first pass).
      out = out.split(v).join(`[REDACTED:${sha256Prefix(v)}]`);
    }
  }
  return out;
}

/** SHA-256 prefix for identifying a token in logs without leaking it.
 * Inlined here after removing `auth.ts#tokenDigest` (#134): the redactor
 * was the only external consumer, and exposing the helper just for one
 * call site is the kind of indirection we don't need. */
function sha256Prefix(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}
