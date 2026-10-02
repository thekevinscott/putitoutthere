/**
 * Normalize an unknown thrown value to an `Error`. `catch (err)` binds
 * `unknown`, and the per-call-site `instanceof` ternary leaves its non-`Error`
 * arm untested wherever the thrower only throws `Error`; one helper tests that
 * arm once. An `Error` comes back by the same reference, type and stack intact.
 */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
