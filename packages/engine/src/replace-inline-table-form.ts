import { setVersionIn } from './set-version-in.js';

/**
 * `demo-core = { path = "../core", version = "0.2" }`, including the
 * multi-line brace form. Cargo dependency entries never nest a further
 * `{ … }`, so the body is everything up to the first `}`.
 */
export function replaceInlineTableForm(source: string, key: string, version: string): string {
  const entry = new RegExp(`^[ \\t]*"?${key}"?[ \\t]*=[ \\t]*\\{[^}]*\\}`, 'gm');
  return source.replace(entry, (whole: string) =>
    whole.includes('path') ? setVersionIn(whole, version) : whole,
  );
}
