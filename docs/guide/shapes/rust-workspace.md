# Multi-crate Rust workspace

This page is for repos that ship **multiple crates to crates.io
from one Cargo workspace** — a `foo-core` + `foo-macros` + `foo`
split, or a family of sibling crates that share a repo. No PyO3,
no napi, no npm — just crates.

`putitoutthere` orchestrates the publish ordering: cascading a
change to `foo-core` through every crate that depends on it,
publishing them in topological order, and cutting a tag per crate.

## What piot covers

| Responsibility                                                                | piot   | Your workflow |
|-------------------------------------------------------------------------------|--------|---------------|
| Decide which crates ship on a given merge (cascade via `depends_on`)          | ✅     |               |
| Topologically order the publishes (dependencies first)                        | ✅     |               |
| Compute the next version from a commit trailer                                | ✅     |               |
| Rewrite `[package].version` in each crate's `Cargo.toml`                      | ✅     |               |
| OIDC trusted publishing to crates.io, per crate                               | ✅     |               |
| Skip-if-already-published idempotency per crate                               | ✅     |               |
| Cut a tag per crate (`{name}-v{version}`)                                     | ✅     |               |
| Update inter-crate version pins in `Cargo.toml` (e.g. `foo-macros = "0.4.1"`) |        | ⚠️ — see gotchas |
| Install Rust toolchain                                                        |        | ✅ ([runner prereqs](/guide/runner-prerequisites)) |
| Register the trusted-publisher policy on crates.io per crate (one-time)       |        | ✅            |

## Package boundaries are declared, not discovered

piot has [no workspace auto-detection](/guide/gaps). You declare
one `[[package]]` entry per crate you want piot to publish. Crates
that are workspace-members but **not** declared in
`putitoutthere.toml` are ignored — piot won't try to publish them
and won't include them in the cascade graph. This is deliberate:
some workspaces contain internal helper crates (test fixtures,
bench harnesses) that should never hit crates.io.

## Configuration shape

One `[[package]]` per published crate, with `depends_on` tracing
the inter-crate dependency graph. piot topologically sorts
publishes based on `depends_on`; sibling crates with no
dependency relationship can publish in parallel.

```toml
[putitoutthere]
version = 1

[[package]]
name = "foo-core"
kind = "crates"
path = "crates/foo-core"
paths = ["crates/foo-core/**", "Cargo.toml", "Cargo.lock"]

[[package]]
name = "foo-macros"
kind = "crates"
path = "crates/foo-macros"
paths = ["crates/foo-macros/**", "Cargo.toml", "Cargo.lock"]
depends_on = ["foo-core"]

[[package]]
name = "foo"
kind = "crates"
path = "crates/foo"
paths = ["crates/foo/**", "Cargo.toml", "Cargo.lock"]
depends_on = ["foo-core", "foo-macros"]
```

A change inside `crates/foo-core/` cascades: all three crates get
versioned and published, in order `foo-core → foo-macros → foo`.
A change only inside `crates/foo/` ships just `foo`.

Keep `Cargo.toml` and `Cargo.lock` in every crate's `paths` —
workspace-level edits (dependency bumps, shared profiles) should
still cascade.

## Workflow shape

The `publish` job runs once, iterating over every planned crate
in order. piot handles the ordering internally; your workflow
doesn't need to fan out:

```yaml
publish:
  needs: plan
  runs-on: ubuntu-latest
  permissions:
    contents: write
    id-token: write
  steps:
    - uses: actions/checkout@v4
      with: { fetch-depth: 0 }
    - uses: dtolnay/rust-toolchain@stable
    - name: Configure git identity
      run: |
        git config --global user.name "github-actions[bot]"
        git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
    - uses: thekevinscott/put-it-out-there@v0
      with:
        command: publish
      env:
        CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}   # fallback only
```

No per-crate `build` job is needed — crates.io compiles from
source. If you want to run `cargo test` / `cargo clippy` first,
gate `publish` behind a separate `test` job via `needs:`.

## One-time prerequisites before your first release

1. Register a trusted publisher on crates.io for **every crate**
   you'll publish. crates.io trust policies are per-crate — a
   policy on `foo-core` does not cover `foo-macros`. For brand-new
   crates with no prior publish, you'll need a one-time bootstrap
   with a scoped `CARGO_REGISTRY_TOKEN`, then switch to OIDC.
2. Declare `[package.trust_policy]` on each `[[package]]` so
   `doctor` catches a rename mismatch per crate.
3. Delete any long-lived `CARGO_REGISTRY_TOKEN` repo secret once
   OIDC works across every crate.

## Gotchas specific to this shape

- **Inter-crate version pins are yours to manage.** When piot
  bumps `foo-core` to `0.4.1`, it rewrites
  `crates/foo-core/Cargo.toml` but **does not** update
  `crates/foo/Cargo.toml`'s `foo-core = "0.4.0"` line. crates.io
  will accept the publish regardless — `cargo publish` pins the
  version resolved from the workspace at publish time — but
  consumers reading your `Cargo.toml` see a stale version pin.
  Either use `path = "..."` dependencies inside the workspace and
  a `workspace = true` version field, or update the pin yourself
  in a pre-commit step. piot is a publisher, not a workspace
  version manager.
- **`Cargo.lock` cascade is broad.** Every crate's `paths`
  includes `Cargo.lock`, so a dependency bump that only touches
  the lock file cascades *every* declared crate. That's usually
  what you want (all crates get a patch bump that picks up the
  bugfix) but it can feel noisy on small lock-only changes. Omit
  `Cargo.lock` from `paths` on a crate you want to insulate.
- **Workspace members you don't publish.** Internal crates
  (benches, test-fixtures) that shouldn't hit crates.io stay out
  of `putitoutthere.toml`. If one ends up there by mistake, piot
  will try to publish it and fail on missing crates.io setup —
  remove the `[[package]]` entry, don't try to fix the publish.
- **`cargo publish` dirty-tree rejection.** If any step between
  checkout and the piot step writes into a crate's source tree,
  `cargo publish` fails with `dirty, aborting`. piot's version
  rewrites are expected and don't trigger this; your own writes do.
- **Per-crate tag pollution.** With N crates, each merge that
  cascades all of them produces N tags (`foo-core-v0.4.1`,
  `foo-macros-v0.4.1`, `foo-v0.4.1`). Consumers reading your tag
  list see 3× the noise of a single-crate repo. That's the cost
  of per-package versioning; if you strongly prefer a single
  shared tag timeline, see the [single-package Rust crate
  shape](/guide/shapes/rust-crate) — but then you lose the
  ability to version crates independently.

## Further reading

- [Single-package Rust crate](/guide/shapes/rust-crate) — if you
  only ship one crate.
- [Polyglot Rust library](/guide/shapes/polyglot-rust) — if your
  workspace also produces PyO3 wheels or a napi npm package.
- [Cascade](/guide/cascade) — how `depends_on` and `paths`
  interact to decide what ships.
- [Configuration reference](/guide/configuration).
- [Runner prerequisites](/guide/runner-prerequisites).
