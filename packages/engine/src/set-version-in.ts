/**
 * Replace the first `version = "…"` value in `segment`. Un-anchored so it
 * covers both the one-line inline table and the multi-line/section forms
 * where the key sits on its own line.
 */
export function setVersionIn(segment: string, version: string): string {
  return segment.replace(/(\bversion[ \t]*=[ \t]*")([^"]*)(")/, `$1${version}$3`);
}
