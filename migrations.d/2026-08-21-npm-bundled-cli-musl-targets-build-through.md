# npm bundled-cli: musl targets build through zigbuild too

**Summary.** The section below moved the npm `bundled-cli` Linux rows to
`cargo zigbuild` at a pinned glibc floor. That change was scoped to the
`*-linux-gnu*` rows, but the step it removed was not: the `musl-tools` +
`CC_<triple>=musl-gcc` install had run on **every** Linux row, including
the rows of a consumer who *declares* a `*-musl` target outright. Those
rows were left with no C cross-compiler (a plain `cargo build`, zig
installed but unused), so any crate compiling C sources failed to link —
and a row that did compile was then failed by the new verify step, which
treats static linkage as fatal on every Linux row while musl output is
static-pie by construction. Musl rows now route through `cargo zigbuild
--target "$RUST_TARGET"` — zig ships musl, so it is the C cross-compiler
that replaced the apt one — with no glibc-floor suffix, since a musl
triple has no glibc to floor and `<triple>.2.17` is not a target zig
accepts. The verify step binds `RUST_TARGET` and applies its
dynamic-linkage and `GLIBC_*`-ceiling assertions to gnu rows only.

**Required changes.** None. No config keys, inputs, or consumer YAML
change. A consumer who had removed a `*-musl` target to work around the
build failure can add it back.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- A declared `*-musl` row builds via `cargo zigbuild` instead of `cargo
  build`, so crates with C sources cross-compile again without the
  consumer supplying a musl toolchain.
- The build-time verify step no longer fails a declared-musl row for
  being statically linked, and no longer runs `objdump -T` against it.
  It logs that the row targets musl and that the gnu-lane checks do not
  apply. gnu rows are unchanged.
- `kind = "pypi"` `[package.bundle_cli]`: when the cross-compile
  produces no binary, the staging step's error branch prints its
  directory listing instead of aborting on `BINARY_TARGET: unbound
  variable` (a leftover of the mapping removed in the pypi section
  below). Only the failure path's output changes.

**Verification.** Declare a `*-musl` target alongside your gnu ones on a
crate with a C-source dependency (`rusqlite` with `bundled` is the
easiest) and run a release. Expect the musl row's build step to log
`cargo zigbuild --release --target <musl triple>` with no `.2.17`
suffix, and its verify step to log `targets musl — static linkage is
expected here`. `npm install` on Alpine then resolves the `-musl`
platform package; `file` on its binary reports `static-pie linked`,
which is now the intended artifact rather than a failure.
