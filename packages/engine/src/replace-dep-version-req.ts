/**
 * Rewrite the `version = "…"` requirement on a **path** dependency,
 * preserving the rest of the manifest byte-for-byte. #621.
 *
 * Bumping an embedded crate without moving the requirements that point at
 * it is worse than leaving it stale: cargo stops resolving entirely.
 *
 *     error: failed to select a version for the requirement `demo-core = "^0.2"`
 *     candidate versions found which didn't match: 0.4.2
 *
 * That is a hard failure (exit 101) before anything compiles, and a
 * `version` key alongside `path` is *mandatory* for any crate that also
 * publishes to crates.io — so the shape that needs this is exactly the
 * shape polyglot repos have.
 *
 * String surgery rather than a TOML round-trip, matching
 * `replaceCargoVersion` and `replaceWorkspacePackageVersion`: re-emitting
 * parsed TOML discards comments and formatting from a file the consumer
 * owns.
 *
 * Only entries that also carry a `path` key are touched. A registry
 * dependency that happens to share the key name keeps its requirement —
 * rewriting pyo3's `0.22` to the release version would pin a version that
 * does not exist.
 */

/** Escape a dependency key for literal use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace the first line-anchored `version = "…"` in `segment`. */
function setVersionIn(segment: string, version: string): string {
  return segment.replace(/(^[ \t]*version[ \t]*=[ \t]*")([^"]*)(")/m, `$1${version}$3`);
}

/**
 * Rewrite every `version` requirement declared for `depKey` **that also
 * declares a `path`**, in either dependency-entry syntax:
 *
 *   - inline table — `demo-core = { path = "../core", version = "0.2" }`
 *   - section table — `[dependencies.demo-core]` / `path` / `version`
 *
 * Both forms are scanned across the whole manifest, so a dependency
 * declared in several tables (normal plus dev, plus a `cfg`-gated one)
 * has every occurrence rewritten. Returns the source unchanged when the
 * key declares no path-plus-version entry.
 */
export function replaceDepVersionReq(source: string, depKey: string, version: string): string {
  const key = escapeRe(depKey);
  let out = replaceSectionTableForm(source, key, version);
  out = replaceInlineTableForm(out, key, version);
  return out;
}

/**
 * `[dependencies.demo-core]` … through to the next table header. Matches
 * any dependency table — `[dev-dependencies.x]`,
 * `[target.'cfg(unix)'.dependencies.x]` — via the `dependencies.` suffix
 * on the header path.
 */
function replaceSectionTableForm(source: string, key: string, version: string): string {
  const header = new RegExp(`^\\[[^\\]\\n]*dependencies\\.${key}\\][ \\t]*$`, 'gm');
  let out = '';
  let cursor = 0;
  for (let m = header.exec(source); m !== null; m = header.exec(source)) {
    const start = m.index + m[0].length;
    // The section runs to the next table header, or to end of file.
    const nextHeader = /^\[/m.exec(source.slice(start));
    const end = nextHeader === null ? source.length : start + nextHeader.index;
    const segment = source.slice(start, end);
    out += source.slice(cursor, start);
    out += segment.includes('path') ? setVersionIn(segment, version) : segment;
    cursor = end;
  }
  return cursor === 0 ? source : out + source.slice(cursor);
}

/**
 * `demo-core = { path = "../core", version = "0.2" }`, including the
 * multi-line brace form. The span is found by counting braces rather than
 * by regex so a nested table (`features = { … }`) cannot end it early.
 */
function replaceInlineTableForm(source: string, key: string, version: string): string {
  const opener = new RegExp(`^[ \\t]*"?${key}"?[ \\t]*=[ \\t]*\\{`, 'gm');
  let out = '';
  let cursor = 0;
  for (let m = opener.exec(source); m !== null; m = opener.exec(source)) {
    const braceStart = m.index + m[0].length - 1;
    const end = matchingBrace(source, braceStart);
    if (end === -1) {continue;}
    const segment = source.slice(braceStart, end + 1);
    out += source.slice(cursor, braceStart);
    out += segment.includes('path') ? setVersionIn(inlineSetVersion(segment, version), version) : segment;
    cursor = end + 1;
    opener.lastIndex = cursor;
  }
  return cursor === 0 ? source : out + source.slice(cursor);
}

/**
 * Inline tables keep the whole entry on one line, so the line-anchored
 * form in `setVersionIn` cannot match. Replace the un-anchored occurrence
 * here; `setVersionIn` then covers the multi-line brace form where each
 * key sits on its own line.
 */
function inlineSetVersion(segment: string, version: string): string {
  return segment.replace(/(\bversion[ \t]*=[ \t]*")([^"]*)(")/, `$1${version}$3`);
}

/** Index of the `}` closing the `{` at `open`, or -1. Skips quoted text. */
function matchingBrace(source: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === '\\') {i++;}
      else if (ch === quote) {quote = null;}
      continue;
    }
    if (ch === '"' || ch === "'") {quote = ch; continue;}
    if (ch === '{') {depth++;}
    else if (ch === '}') {
      depth--;
      if (depth === 0) {return i;}
    }
  }
  return -1;
}
