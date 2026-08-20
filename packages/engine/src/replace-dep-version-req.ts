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
  return replaceInlineTableForm(replaceSectionTableForm(source, key, version), key, version);
}

/**
 * `[dependencies.demo-core]` … through to the next table header. Matches
 * any dependency table — `[dev-dependencies.x]`,
 * `[target.'cfg(unix)'.dependencies.x]` — via the `dependencies.` suffix
 * on the header path. The body is consumed line by line, refusing any
 * line that opens a new table, so a `[` inside a value (`features =
 * ["cli"]`) cannot end the section early.
 */
function replaceSectionTableForm(source: string, key: string, version: string): string {
  const section = new RegExp(
    `(^\\[[^\\]\\n]*dependencies\\.${key}\\][^\\n]*\\n)((?:(?!\\[)[^\\n]*(?:\\n|$))*)`,
    'gm',
  );
  return source.replace(section, (whole, header: string, body: string) =>
    body.includes('path') ? header + setVersionIn(body, version) : whole,
  );
}

/**
 * `demo-core = { path = "../core", version = "0.2" }`, including the
 * multi-line brace form. Cargo dependency entries never nest a further
 * `{ … }`, so the body is everything up to the first `}`.
 */
function replaceInlineTableForm(source: string, key: string, version: string): string {
  const entry = new RegExp(`^[ \\t]*"?${key}"?[ \\t]*=[ \\t]*\\{[^}]*\\}`, 'gm');
  return source.replace(entry, (whole: string) =>
    whole.includes('path') ? setVersionIn(whole, version) : whole,
  );
}

/**
 * Replace the first `version = "…"` value in `segment`. Un-anchored so it
 * covers both the one-line inline table and the multi-line/section forms
 * where the key sits on its own line.
 */
function setVersionIn(segment: string, version: string): string {
  return segment.replace(/(\bversion[ \t]*=[ \t]*")([^"]*)(")/, `$1${version}$3`);
}
