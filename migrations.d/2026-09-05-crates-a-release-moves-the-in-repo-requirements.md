# crates: a release moves the in-repo requirements pointing at it

**Summary.** With two `kind = "crates"` packages in one repo where A
path-deps B, releasing B bumped only B's own `Cargo.toml`. A's
requirement on B stayed where it was, and the moment B's new version fell
outside A's declared range cargo stopped resolving the workspace
entirely:

```
error: failed to select a version for the requirement `expcore = "^0.2"`
candidate versions found which didn't match: 0.4.2
location searched: .../packages/core
```

That is a hard failure (exit 101) before anything compiles or packages,
and an intermittent one — a repo releasing patches stays green for months
and detonates on the first bump that leaves the range. A `version` key
alongside `path` is *mandatory* for any crate that also publishes to
crates.io, so the shape that breaks is the shape such a repo is required
to have. #621 taught the build-time writers to move these requirements
for the crates an artifact embeds; the publish path never learned it
(issue #640).

`writeVersion` for crates now rewrites every in-repo requirement that
resolves to the crate it just bumped, in all three syntaxes cargo
accepts: inline table (`b = { path = "../b", version = "0.2" }`), section
table (`[dependencies.b]`), and a requirement inherited from the
workspace root's `[workspace.dependencies]` — the last of which lives in
a file no member's own rewrite would touch. Candidates are the workspace
root, its members (expanded the way cargo expands `members`), and the
other declared packages, so a crate the repo does not publish but which
sits between two that it does is still covered.

**Required changes.** None.

| | Before | After |
|---|---|---|
| `putitoutthere.toml` | no change | no change |
| Reusable workflow inputs | no change | no change |
| `Cargo.toml` of a crate that path-deps a released crate | requirement left behind; `cargo` refuses to resolve | requirement moved to the released version |
| Registry dependencies (`pyo3 = { version = "0.22" }`) | untouched | untouched |
| Path dependencies with no `version` key | untouched | untouched |

**Deprecations removed.** None.

**Behavior changes without code changes.**

- A crates release now writes manifests **outside** the package
  directory — the dependents' and, for an inherited requirement, the
  workspace root's. These rewrites are ephemeral: the publish job runs
  from a fresh checkout and nothing is committed, exactly as with #621's
  build-time rewrites.
- The pre-publish dirty-tree guard (which refuses to
  `cargo publish --allow-dirty` when anything outside the managed
  manifest is dirty) now recognizes every manifest the run rewrote,
  **accumulated across the whole cascade** rather than per package. A
  manifest rewritten while publishing the first package is still dirty
  when the second publishes, and it is no more a stray edit then than it
  was then. Stray edits are still refused.
- Only requirements resolving to the crate being released move. A
  registry dependency that happens to share a key name keeps its
  requirement, and a path dependency carrying no `version` key is left
  alone rather than having one invented for it.

**Verification.** In a repo with two crates.io packages where one
path-deps the other with a `version` requirement, release the dependency
at a version outside that requirement's range. Before this fix,
`cargo metadata` on the resulting tree failed with
`failed to select a version for the requirement`; now it resolves, and
the dependent's `req` matches the released version.

---
