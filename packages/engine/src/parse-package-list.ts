/**
 * Parse a trailer's `[pkg, pkg]` list. Names follow what npm, crates.io and
 * PyPI accept: letters, digits, hyphen, underscore, dot.
 */
export function parsePackageList(s: string): string[] | null {
  const packageName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (!s.startsWith('[')) {return null;}
  const closeIdx = s.indexOf(']');
  if (closeIdx === -1) {return null;}
  const tail = s.slice(closeIdx + 1).trim();
  if (tail.length > 0) {return null;}
  const inner = s.slice(1, closeIdx).trim();
  if (inner === '') {return [];}
  const parts = inner.split(',').map((p) => p.trim());
  for (const name of parts) {
    if (name === '' || !packageName.test(name)) {return null;}
  }
  return parts;
}
