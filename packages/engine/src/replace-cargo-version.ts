/**
 * Rewrite the `version = "..."` assignment inside a manifest's `[package]`
 * table, preserving everything else byte-for-byte.
 *
 * String surgery rather than a TOML round-trip, matching
 * `replaceWorkspacePackageVersion` and `replaceDepVersionReq`: re-emitting
 * parsed TOML discards the comments and formatting of a file the consumer
 * owns.
 *
 * Lives in its own module rather than inside `handlers/crates.ts` so both
 * the crates publish path and `writeResolvedCargoVersion` can reach it
 * without an import cycle between the handler and the resolver it now
 * delegates to. #639.
 *
 * **The match is bounded to the `[package]` table.** The original expression
 *
 *     /(\[package\][\s\S]*?)(^\s*version\s*=\s*")([^"]*)(")/m
 *
 * was lazy and anchored only on the `[package]` *header*, so on a manifest
 * with no literal `[package].version` — one that inherits via
 * `version.workspace = true` — it walked past the table boundary and matched
 * the next `version = "..."` in the file, typically a dependency's
 * requirement in a section table. It then rewrote that requirement to the
 * release version, naming a release of someone else's crate that does not
 * exist, and reported success.
 *
 * Callers that need to handle inheritance go through
 * `writeResolvedCargoVersion`, which detects it first and rewrites
 * `[workspace.package].version` at the workspace root instead. This function
 * stays literal-only on purpose; bounding the table means it now fails loud
 * on a manifest it cannot legitimately rewrite instead of corrupting a
 * neighbouring field.
 */

/**
 * The `[package]` table's body: its header line, then every following line
 * up to the next table header. Refusing any line that opens a table is what
 * keeps the match inside the table — the same technique
 * `replaceDepVersionReq` uses for `[dependencies.<key>]`.
 */
const PACKAGE_TABLE = /^\[package\][^\n]*\n((?:(?!\[)[^\n]*(?:\n|$))*)/m;

/** A literal `version = "..."` assignment on its own line. */
const VERSION_LINE = /^[ \t]*version[ \t]*=[ \t]*"([^"]*)"/m;

export function replaceCargoVersion(source: string, version: string): string {
  const table = PACKAGE_TABLE.exec(source);
  const body = table?.[1];
  const line = body === undefined ? null : VERSION_LINE.exec(body);
  if (table === null || body === undefined || line === null) {
    throw new Error('Cargo.toml: no [package].version field found');
  }
  const old = line[1] as string;
  if (old === version) {return source;}
  // Offsets are resolved against the original source: the table body starts
  // after its header, and the value starts after the `version = "` prefix
  // within the matched line.
  const bodyStart = table.index + table[0].length - body.length;
  const valueStart = bodyStart + line.index + line[0].length - old.length - 1;
  return source.slice(0, valueStart) + version + source.slice(valueStart + old.length);
}
