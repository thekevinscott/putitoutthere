# Dual-family npm (CLI + napi)

This page is for projects that need **both a napi addon and a CLI
binary from the same Rust core**, published to npm. The canonical
example is `dirsql`: one Rust crate that produces a napi `.node`
addon *and* a standalone `dirsql` CLI, both reached via
`npm install dirsql`.

Read this page before assuming piot covers your shape end-to-end.
It does not — piot deliberately restricts each `[[package]]` to
one `build` mode. The workaround is to split into two top-level
npm packages and document the join.

## The pattern

A "dual-family" shape means one conceptual library has two
install-time payloads:

- `require('my-lib')` → native addon (napi `.node` file).
- `my-lib` on PATH (via `bin:` in `package.json`) → CLI binary.

Distributed naively, that's **two** per-platform families glued
together by one top-level package's `optionalDependencies`:

```
my-lib                                    ← top-level
├── optionalDependencies
│   ├── @scope/my-lib-addon-<triple>     ← napi family, × N
│   └── @scope/my-lib-cli-<triple>       ← bundled-cli family, × N
└── bin: bin/my-lib.js                    ← launcher shim
```

`dirsql` ships this shape today (hand-rolled, pre-piot): 11 sub-
packages (5 napi + 5 CLI + 1 top-level) under one install name.

## What piot supports — and what it doesn't

piot's `build = "napi"` publishes a napi family under one
top-level name. piot's `build = "bundled-cli"` publishes a CLI
family under one top-level name. Each `[[package]]` picks one
`build` mode — **there is no combined mode that emits both
families under one top-level**.

This is a [deliberate known gap](/guide/gaps) ("Combined CLI + napi
under one top-level package"), not a bug. The workaround is:

> Split into two published names — one for the library, one for
> the CLI — and have consumers install both (or have one depend
> on the other).

## The split-package workaround

Declare two `[[package]]` entries, each with its own top-level
npm name:

```toml
[putitoutthere]
version = 1

[[package]]
name = "my-crate"
kind = "crates"
path = "crates/my-crate"
paths = ["crates/my-crate/**", "Cargo.toml", "Cargo.lock"]

[[package]]
name = "my-lib"
kind = "npm"
npm  = "my-lib"                            # library-facing install name
build = "napi"
path = "packages/ts-lib"
paths = ["packages/ts-lib/**", "crates/my-crate/**"]
targets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
]
depends_on = ["my-crate"]

[[package]]
name = "my-cli"
kind = "npm"
npm  = "my-cli"                            # CLI-facing install name
build = "bundled-cli"
path = "packages/ts-cli"
paths = ["packages/ts-cli/**", "crates/my-crate/**"]
targets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
]
depends_on = ["my-crate"]
```

Consumers run one of:

- `npm install my-lib` — gets the napi addon only.
- `npm install -g my-cli` — gets the binary on PATH only.
- `npm install my-lib my-cli` — gets both.

If you want a single `npm install my-lib` to deliver both, make
`my-lib`'s `package.json` declare `"dependencies": { "my-cli":
"x.y.z" }`. `my-cli`'s top-level `bin` then ends up on PATH for
anyone who installs `my-lib`. (Version-pinning across the two
has to be manual — keep them in lockstep via piot's cascade,
which already re-versions both when the shared `my-crate`
changes.)

## Why piot doesn't merge the two

Three reasons, in order of weight:

1. **Two families in one `package.json` crosses a boundary.** The
   top-level `optionalDependencies` has to pin entries from two
   unrelated naming conventions (`@scope/my-lib-addon-<triple>`
   and `@scope/my-lib-cli-<triple>`). That's not hard to
   generate, but the launcher script has to pick between them at
   runtime (addon load vs. CLI spawn), and the shape of that
   shim is application-specific. piot would own half of a
   contract the consumer owns the other half of.
2. **Provenance claims get muddier.** Each sub-package currently
   claims provenance from a single published top-level. A merged
   top-level would claim provenance from two disjoint build
   paths, and the registry representation gets fiddly.
3. **The split is cheap.** Two `[[package]]` entries and two
   install names is a small tax to pay for a pattern most
   consumers won't need.

If your project genuinely requires the single-top-level layout
(e.g. you're migrating from a hand-rolled release pipeline that
already publishes under that shape, and changing the install
name would break existing users), see
[Migrating an existing dual-family package](#migrating-an-existing-dual-family-package)
below.

## Migrating an existing dual-family package

If your package already ships with one top-level pinning two
families' worth of `optionalDependencies` and you can't rename
it, you have two options:

**Option A — shrink to one family, break the install contract
for the other half.** Pick one payload (addon or CLI) as canonical
for the top-level name. Republish the other half under a new
name (`my-lib-cli`, say). Announce the split in your release
notes; existing installs keep working until the user upgrades.

**Option B — keep piot out of that package and hand-roll it.**
Use piot for the plain crate and any other packages in the repo;
leave the existing hand-rolled `publish-npm.yml` workflow in
place for the dual-family top-level. Not elegant, but it's the
most common outcome when the install contract is load-bearing.
Revisit periodically as piot's scope evolves — the gap is
acknowledged, not permanent.

Neither option is great. That's why piot encourages the split
shape above for *new* projects.

## Further reading

- [Known gaps](/guide/gaps) — "Combined CLI + napi under one
  top-level package" is the declaration this page implements a
  workaround for.
- [npm platform packages](/guide/npm-platform-packages) — how
  each single family is laid out.
- [Rust + napi npm](/guide/shapes/rust-napi) — the library half
  of the split.
- [Bundled-CLI npm family](/guide/shapes/bundled-cli) — the CLI
  half of the split.
- [Polyglot Rust library](/guide/shapes/polyglot-rust) — if you
  also publish PyO3 wheels from the same Rust core.
