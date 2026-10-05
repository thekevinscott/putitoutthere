# Consumer build scripts receive `VERSION`

**Summary.** The reusable workflow runs your `package.json` `build` script
on `kind = "npm"` rows, and passed it exactly two variables: `TARGET` (the
triple to cross-compile) and `BUILD` (the mode to dispatch on). It never
passed the version being released. It now passes `VERSION` as well, at
every point it invokes your script — the per-target build matrix and the
publish-time rebuild alike.

This closes a silent hole on the roll-your-own path. A package declaring
`build = "bundled-cli"` *without* a `[package.bundle_cli]` block owns its
own cross-compile, and no version source on disk was correct at the moment
that script ran: `write-crate-version` is gated on `matrix.bundle_cli` (or,
for napi, a colocated `Cargo.toml`), `write-version` is gated on
pypi/maturin rows, and an npm package's `package.json` is not rewritten
until the publish job. Since cargo bakes `CARGO_PKG_VERSION` from
`Cargo.toml` at compile time and honors no env override, the shipped binary
reported the previously committed version — and nothing failed to say so.

**Required changes.** None. `VERSION` is additive; a build script that
ignores it behaves exactly as before, and no existing variable changed.

You *should* adopt it if you build a Rust binary in your own script. Stamp
the manifest before invoking cargo:

| | before | after |
| --- | --- | --- |
| `scripts/build.mjs` | `cargo build --release --target $TARGET …` | write `Cargo.toml`'s `[package] version` from `process.env.VERSION`, **then** `cargo build …` |

See [README → Bundled-CLI npm family](../README.md#bundled-cli-npm-family)
for a copy-paste snippet. The same applies to a **napi** crate that does
not sit beside `package.json` — the workflow logs a `::notice::` saying it
skipped the pre-build bump, and `VERSION` is now how you do it yourself. A
colocated napi crate is still bumped for you and needs no change.

Declaring `[package.bundle_cli]` remains the better answer where the recipe
fits: it does the version write for you, and gets you the zigbuild glibc
floor.

**Deprecations removed.** None.

**Behavior changes without code changes.** `VERSION` is present in the
build-step environment where it previously was not. A build script that
already read a variable of that name from some other source — a repo-level
`env:`, a `.env` file loaded by the script itself — will now see the
workflow's value at that layer instead. Nothing else about the build step
changed: same working directory, same install fallback, same ordering
against the engine's staging step.

**Verification.** Add a line to your build script and read it back in the
release run's log:

```js
console.log(`building ${process.env.TARGET} for version ${process.env.VERSION}`);
```

For a Rust binary, the end-to-end check is the published artifact itself —
install the freshly released package and run it:

```console
$ npm install -g my-cli && my-cli --version
my-cli 1.4.0        # the version just released, not the previous one
```

If it still prints the previous version, your script is not stamping the
manifest before `cargo build`.

---
