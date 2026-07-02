/**
 * Rewrites the first `version = "..."` under the `[workspace.package]`
 * table, preserving the rest of the file byte-for-byte. Throws if the
 * field is absent. The `[workspace.package]` mirror of
 * `replaceCargoVersion` (`src/handlers/crates.ts`), for crates that
 * inherit their version via `version.workspace = true`. #428.
 */
export function replaceWorkspacePackageVersion(source: string, version: string): string {
  // [workspace.package] header, then the first `version = "x.y.z"` line.
  const re = /(\[workspace\.package\][\s\S]*?)(^\s*version\s*=\s*")([^"]*)(")/m;
  const m = re.exec(source);
  if (!m) {
    throw new Error('Cargo.toml: no [workspace.package].version field found');
  }
  const [, pre, prefix, old, suffix] = m as unknown as [string, string, string, string, string];
  if (old === version) {
    return source;
  }
  const start = m.index + pre.length;
  const end = start + prefix.length + old.length + suffix.length;
  return source.slice(0, start) + prefix + version + suffix + source.slice(end);
}
