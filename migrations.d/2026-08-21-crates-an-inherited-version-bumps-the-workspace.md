# crates: an inherited version bumps the workspace root, not a dependency

**Summary.** A `kind = "crates"` package whose `Cargo.toml` inherits its
version (`version.workspace = true` rather than a literal
`[package].version`) was released against the wrong field. The publish
path used a rewriter that matched the first `version = "…"` after the
`[package]` header without checking that line was still inside the
`[package]` table. With no literal version there to find, the match ran
past the table boundary and landed on whatever came next — in practice a
**dependency's** requirement declared in section-table form
(`[dependencies.pyo3]` / `[dev-dependencies.…]`, as opposed to the inline
`{ … }` form). The release then left the package's own version untouched
and rewrote that dependency's requirement to the release version, naming
a release of someone else's crate that does not exist, and reported
success. Depending on whether the corrupted requirement happened to stay
satisfiable, the result was either a crate that fails to resolve or one
that silently resolves to a version nobody chose.

`writeVersion` for crates now routes through the same
workspace-inheritance resolver the maturin (`write-version`) and
bundled-cli/napi (`write-crate-version`) pre-build writers have used
since #428: a literal `[package].version` is rewritten in place, and an
inheriting crate has the workspace root's `[workspace.package].version`
rewritten instead. Dependency requirements are never touched. The
literal-only rewriter is now bounded to the `[package]` table, so a
manifest it cannot legitimately rewrite fails loud rather than corrupting
a neighbouring field (issue #639).

**Required changes.** None. If you kept a literal `[package].version`
specifically to avoid this, you can now switch to
`version.workspace = true` — but note that is a change to your manifest,
not something the upgrade requires.

| | Before | After |
|---|---|---|
| `putitoutthere.toml` | no change | no change |
| Reusable workflow inputs | no change | no change |
| `Cargo.toml` (literal version) | bumped in place | bumped in place, unchanged |
| `Cargo.toml` (`version.workspace = true`) | a dependency's requirement was rewritten | workspace root's `[workspace.package].version` is bumped |

**Deprecations removed.** None.

**Behavior changes without code changes.**

- An inheriting crate's release now writes the **workspace root**
  `Cargo.toml` rather than the package's own. The pre-publish dirty-tree
  guard (which refuses to `cargo publish --allow-dirty` when anything
  outside the managed manifest is dirty) was taught about this, so the
  workspace-root write is recognized as the managed bump rather than
  reported as a stray edit. No consumer action is needed; a release that
  previously corrupted a requirement now simply succeeds.
- A `Cargo.toml` with neither a literal `[package].version` nor a
  resolvable workspace inheritance now fails with
  `Cargo.toml: no [package].version field found` instead of rewriting an
  unrelated field. This is a manifest that could never have been released
  correctly.

**Verification.** Release a crate that declares
`version.workspace = true` and has at least one dependency in
section-table form. After the run, the workspace root's
`[workspace.package].version` matches the released version, and
`cargo metadata --no-deps` reports every dependency requirement exactly
as you wrote it. Before this fix the dependency's `req` came back as the
release version.

---
