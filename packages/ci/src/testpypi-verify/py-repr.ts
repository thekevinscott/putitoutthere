/**
 * Reproduce Python's `repr()` for the values the TestPyPI verify/assert bash
 * interpolated with `!r` — a downloaded artifact's version string, or `None`
 * when no `Version:` line was found. The bash error messages read
 * `Version={actual!r}, expected {version!r}`; those values are always simple
 * version strings (no embedded quotes) or `None`, so single-quote wrapping is
 * byte-for-byte faithful to CPython's `repr` over this domain. Pure.
 */

export function pyRepr(value: string | null): string {
  if (value === null) {
    return 'None';
  }
  return `'${value}'`;
}
