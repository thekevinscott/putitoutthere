# npm platform packages

When a npm package ships a native binary that varies per platform
(a Rust CLI, a napi-rs addon, anything compiled), publishing as a
single package means every install downloads every platform's binary
and throws most of them away. The idiomatic fix is a **platform-package
family**: one package per `{os, cpu}` pair, plus a top-level package
that pins the right one via `optionalDependencies`. esbuild, swc,
biome, and turborepo all ship this way.

`putitoutthere` generates the family for you when you set
`build = "napi"` or `build = "bundled-cli"` on a `kind = "npm"`
package.

## What `build = "napi"` does

Publishes one `.node` addon per target, plus a top-level that
requires them optionally and picks the right one at load time.

```toml
[[package]]
name = "my-napi"
kind = "npm"
npm  = "my-lib"                           # published as @scope/my-lib
build = "napi"
targets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
]
path = "packages/ts"
paths = ["packages/ts/**"]
```

At publish time piot:

1. **Synthesizes a per-platform package for every target.** Each
   sub-package is named `{name}-{target}` (here: `my-napi-x86_64-unknown-linux-gnu`,
   etc.). Its `package.json` narrows `os` and `cpu` so npm refuses to
   install it on the wrong platform:

   ```json
   {
     "name": "my-napi-aarch64-apple-darwin",
     "version": "1.2.3",
     "os": ["darwin"],
     "cpu": ["arm64"],
     "main": "index.node"
   }
   ```

   On Linux `linux-gnu` / `linux-musl` triples, a `libc` field is
   added too (`["glibc"]` or `["musl"]`) so glibc consumers don't
   accidentally resolve the musl build.

2. **Publishes each per-platform package.** `npm publish --provenance`,
   skipping any that already exist at this version (idempotent
   re-runs).

3. **Rewrites the top-level `package.json`** to add
   `optionalDependencies` pointing at every per-platform package at
   the just-published version:

   ```json
   {
     "name": "my-lib",
     "version": "1.2.3",
     "optionalDependencies": {
       "my-napi-x86_64-unknown-linux-gnu":   "1.2.3",
       "my-napi-aarch64-unknown-linux-gnu":  "1.2.3",
       "my-napi-x86_64-apple-darwin":        "1.2.3",
       "my-napi-aarch64-apple-darwin":       "1.2.3",
       "my-napi-x86_64-pc-windows-msvc":     "1.2.3"
     }
   }
   ```

4. **Publishes the top-level package last.** If any platform
   publish failed in step 2, the top-level never ships and users
   don't see a half-populated family.

At `npm install my-lib`, npm's `optionalDependencies` resolution
picks exactly one sub-package matching the user's `os` + `cpu` +
`libc` and skips the rest.

## What `build = "bundled-cli"` does

Same family structure, different payload. Instead of a napi `.node`
addon, each per-platform package carries a statically-compiled CLI
binary (Rust `cargo build --release`, Go `go build`, whatever your
toolchain produces). Use this when you want `npm install my-tool` to
give users a working `my-tool` shim on PATH.

The config is identical to napi except for the `build` value:

```toml
[[package]]
name = "my-cli"
kind = "npm"
npm  = "my-cli"
build = "bundled-cli"
targets = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin", ...]
path = "packages/ts-cli"
paths = ["packages/ts-cli/**"]
```

The generated per-platform package carries the binary as its `main`
file; the top-level package's `bin` field points at a small launcher
script that `spawn`s the right platform binary via a `require.resolve`
lookup into `optionalDependencies`. You write the launcher once;
piot wires the version pins.

## Publish-side vs. build-side

`build = "napi"` and `build = "bundled-cli"` tell piot **how to
publish** the artifacts. They do not build them. Your workflow's
`build` job compiles the binaries (via `maturin`, `napi build`,
`cargo`, whatever) and drops them into the per-target artifact
directory piot expects. The publish phase picks them up from there.

This is the same split as the Python `build = "maturin"` / `hatch` /
`setuptools` modes: a declarative *packaging shape* piot knows how
to publish. Producing the binaries is the consumer's responsibility.
piot emits the build-job matrix (with per-target `runner` overrides
you can declare in config — see
[Configuration → Target entries](/guide/configuration#target-entries)),
but the compile step itself lives in your workflow.

## Constraints worth knowing

- **Target triples** must match a known OS pattern (`linux`,
  `darwin`, `win32`/`windows`/`msvc`) and CPU pattern
  (`x86_64`/`x64`, `aarch64`/`arm64`, `armv7`). Unknown triples
  (e.g. `riscv64-*`, `powerpc64le-*`) are rejected at `plan` time
  with a clear error — they used to silently synthesise a
  no-constraints per-platform package; that class of failure is now
  caught loudly.
- **Scoped names** work: set `npm = "@myorg/mytool"`. Per-platform
  sub-packages inherit the scope.
- **Shipping `cli` + `napi` in the same top-level package** is not
  supported. Each `[[package]]` picks one `build` mode. If you need
  a published package that bundles both a CLI binary *and* a napi
  addon under one name, declare them as two packages and consume one
  from the other.
