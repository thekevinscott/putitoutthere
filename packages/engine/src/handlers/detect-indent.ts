/**
 * Detect the indentation style of a pretty-printed JSON document so a
 * rewrite can preserve it: `2` / `4` (space counts) or `'\t'` for tabs.
 * Defaults to `2` when the source has no indented line to sample (e.g. a
 * minified one-liner). Shared by the npm and npm-platform handlers, which
 * both round-trip a package.json without reflowing it.
 */
export function detectIndent(source: string): number | string {
  // `^…"` (multiline) anchors to a line's leading whitespace before a key
  // quote, so an inline `": "` inside a value is never mistaken for indent.
  const indent = /^([ \t]+)"/m.exec(source)?.[1];
  if (indent === undefined) {return 2;}
  if (indent.includes('\t')) {return '\t';}
  return indent.length;
}
