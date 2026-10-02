/**
 * Reproduce Python's `repr()` for the values the TestPyPI verify/assert bash
 * interpolated with `!r` — a version string, or `None` when no `Version:` line
 * was found. Those values never contain quotes, so single-quote wrapping is
 * byte-for-byte faithful to CPython's `repr` over this domain. Pure.
 */

export function pyRepr(value: string | null): string {
  if (value === null) {
    return 'None';
  }
  return `'${value}'`;
}
