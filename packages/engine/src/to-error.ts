/**
 * Normalize an unknown thrown value to an `Error`.
 *
 * `catch (err)` binds `err: unknown` — a `throw` can carry any value, not just
 * an `Error`. Most call sites want an `Error` (to read `.message`, or to
 * reject/rethrow), and hand-writing `err instanceof Error ? err : new
 * Error(String(err))` at each one leaves the non-`Error` arm untested wherever
 * the thrower only ever throws `Error` in practice. Routing through this one
 * helper tests that arm once, here, so the call sites need no per-site
 * coverage exception.
 *
 * An `Error` value is returned unchanged (same reference, preserving its type
 * and stack); any other value is wrapped as `new Error(String(value))`, whose
 * `.message` is the stringified value.
 */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
