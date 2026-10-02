/**
 * Rewrite the `version = "..."` assignment inside a manifest's `[package]`
 * table byte-preservingly (string surgery: re-emitting parsed TOML discards
 * the consumer's comments). **Bounded to the `[package]` table** — an earlier
 * lazy regex walked past it and silently rewrote a dependency's req (#639).
 */

/**
 * The `[package]` table's body: its header line, then every following line
 * up to the next table header. Refusing any line that opens a table is what
 * keeps the match inside the table — the same technique
 * `replaceDepVersionReq` uses for `[dependencies.<key>]`.
 *
 * The `^` anchor matters: without it a `[package]` mentioned in a comment
 * would start the match, and the body would then run from the comment to the
 * real table header and stop there — empty.
 */
const PACKAGE_TABLE = /^\[package\][^\n]*\n((?:(?!\[)[^\n]*(?:\n|$))*)/m;

/**
 * A literal `version = "..."` assignment on its own line. Anchored so a
 * `version = "…"` inside a comment cannot be mistaken for the assignment,
 * and tolerant of indentation and of spacing around the `=`.
 */
const VERSION_LINE = /^[ \t]*version[ \t]*=[ \t]*"([^"]*)"/m;

const NO_VERSION = 'Cargo.toml: no [package].version field found';

export function replaceCargoVersion(source: string, version: string): string {
  const table = PACKAGE_TABLE.exec(source);
  if (table === null) {throw new Error(NO_VERSION);}
  const body = table[1] as string;

  const line = VERSION_LINE.exec(body);
  if (line === null) {throw new Error(NO_VERSION);}
  const old = line[1] as string;

  // Offsets resolve against the original source: the table body starts after
  // its header, and the value starts after this line's `version = "` prefix.
  // Rewriting by offset rather than by `String.replace` keeps every other
  // byte — comments, spacing, a same-valued `version` elsewhere — untouched.
  const bodyStart = table.index + table[0].length - body.length;
  const valueStart = bodyStart + line.index + line[0].length - old.length - 1;
  return source.slice(0, valueStart) + version + source.slice(valueStart + old.length);
}
