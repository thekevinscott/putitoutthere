# Crates dirty-check whitelists sibling package paths

**Summary.** The engine's pre-publish dirty-workspace check
(`scanDirtyOutsideManifest` in `src/handlers/crates.ts`) used to
flag any dirty file in the repo outside the package's own
`Cargo.toml`. For polyglot consumers (rust + js in one repo), the
reusable workflow's `Build npm packages` step (added in #256) runs
`npm install + npm run build` for each npm package in the plan
before the engine publishes anything. That creates `node_modules/`,
`package-lock.json`, and `dist/` inside each npm package's path as
untracked files. cargo's git-status check sees them and the engine
refuses with `cargo publish: refusing to proceed; unexpected dirty
files in the working tree outside <crate>/Cargo.toml`.

The check now whitelists every other configured package's path
(`siblingPackagePaths` in `Ctx`), the same way it already
whitelists the reusable workflow's `artifacts/` scratch dir. cargo
only packs files inside its own package directory, so dirty state
in sibling packages can't end up in the crate tarball regardless.
Stray edits elsewhere in the repo (a `README.md` change, an
unrelated source file mod) still fail the check.

**Required changes.** None for consumers calling the reusable
workflow at `thekevinscott/putitoutthere/.github/workflows/release.yml@v0`.
This is a pure relaxation: setups that previously published cleanly
continue to; setups that hit the false-positive failure now succeed.

**Deprecations removed.** None.

**Behavior changes without code changes.** A polyglot release run
that previously failed with the "unexpected dirty files" message
on `node_modules/` / `package-lock.json` / `dist/` in a sibling npm
package now proceeds. The published crate tarball is unchanged
(cargo always scoped its packing to the crate dir).

**Verification.** A polyglot repo with rust + js packages and a
crates row in the matrix now reaches `cargo publish` instead of
the dirty-check error. After a release, the crate tarball still
contains only files inside the crate's own dir:

```sh
cargo package --list --manifest-path <crate>/Cargo.toml
```
