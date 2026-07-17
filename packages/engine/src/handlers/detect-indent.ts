/**
 * Detect the indentation style of a pretty-printed JSON document so a
 * rewrite can preserve it: `2` / `4` (space counts) or `'\t'` for tabs.
 * Defaults to `2` when the source has no indented line to sample (e.g. a
 * minified one-liner). Shared by the npm and npm-platform handlers, which
 * both round-trip a package.json without reflowing it.
 */
export function detectIndent(source: string): number | string {
  const m = /^(?<indent>[ \t]+)"/m.exec(source);
  if (!m?.groups?.indent) {return 2;}
  const indent = m.groups.indent;
  if (indent.includes('\t')) {return '\t';}
  return indent.length;
}
