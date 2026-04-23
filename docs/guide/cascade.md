# Cascade

**Cascade** is how `putitoutthere` answers: _which packages need to release on this merge?_

## The two-pass resolver

**Pass 1 — direct match.** For each package, compare the merge's changed files against `paths` globs. Every match adds that package to the plan.

**Pass 2 — transitive `depends_on`.** Any package whose `depends_on` intersects the current plan is added. Repeat until the plan stops growing (fixed-point).

## Cycle detection

At config load, `putitoutthere` DFS-traverses `depends_on` with white/gray/black coloring. A back-edge throws before any plan runs — no release half-completes because of a misconfig.

## First release

No prior tag matching `{name}-v*.*.*`? The package is treated as "changed since the beginning of time" — effectively, every file counts. First-release version comes from `first_version` (default `0.1.0`).

## Glob rules

- `**` matches across directory separators.
- Patterns are anchored at the repo root (minimatch `matchBase: false`).
  A leading `**/` is **not** implicit — write it explicitly when you want a
  pattern to match at any depth. For example, `Cargo.lock` only matches the
  top-level file; use `**/Cargo.lock` to cascade on nested lockfiles too.
- Dotfiles match (minimatch `dot: true`).
- `.gitignore`-style negation is **not** supported. Keep globs inclusive.

## Examples

```toml
# cascades when anything under src/ or Cargo.toml changes
paths = ["src/**", "Cargo.toml"]

# cross-package depends_on
[[package]]
name = "my-rust"
paths = ["crates/my-rust/**"]

[[package]]
name = "my-py"
paths = ["py/my-py/**"]
depends_on = ["my-rust"]    # merges touching crates/my-rust cascade my-py too
```
