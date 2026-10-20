import { setVersionIn } from './set-version-in.js';

/**
 * `[dependencies.demo-core]` … through to the next table header. Matches
 * any dependency table — `[dev-dependencies.x]`,
 * `[target.'cfg(unix)'.dependencies.x]` — via the `dependencies.` suffix
 * on the header path. The body is consumed line by line, refusing any
 * line that opens a new table, so a `[` inside a value (`features =
 * ["cli"]`) cannot end the section early.
 */
export function replaceSectionTableForm(source: string, key: string, version: string): string {
  const section = new RegExp(
    `(^\\[[^\\]\\n]*dependencies\\.${key}\\][^\\n]*\\n)((?:(?!\\[)[^\\n]*(?:\\n|$))*)`,
    'gm',
  );
  return source.replace(section, (whole, header: string, body: string) =>
    body.includes('path') ? header + setVersionIn(body, version) : whole,
  );
}
