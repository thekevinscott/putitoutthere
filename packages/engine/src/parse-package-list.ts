/**
 * Parse a trailer's `[pkg, pkg]` list. Names follow what npm, crates.io and
 * PyPI accept: letters, digits, hyphen, underscore, dot.
 */
export function parsePackageList(s: string): string[] | null {
  const list = /^\[([^\]]*)\]\s*$/.exec(s);
  if (!list) {return null;}
  const inner = list[1]!.trim();
  if (inner === '') {return [];}
  const parts = inner.split(',').map((p) => p.trim());
  return parts.every((name) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) ? parts : null;
}
