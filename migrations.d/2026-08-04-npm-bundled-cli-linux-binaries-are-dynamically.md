# npm bundled-cli Linux binaries are dynamically linked (gnu, glibc ≥ 2.17)

**Summary.** The npm `bundled-cli` lane no longer applies the #381
gnu→musl mapping: Linux CLI binaries are compiled with `cargo zigbuild`
against the declared `*-linux-gnu` triple with a **pinned glibc floor of
2.17** (the manylinux2014 baseline), and are dynamically linked. A
static-pie musl binary cannot `dlopen`, so SQLite extension loading (and
any other runtime `dlopen`) through the published npm CLI failed with
`Dynamic loading not supported` (dirsql#762). Unlike the pypi lane
(#603), npm has no install-time glibc gate — so instead of inheriting
the runner's glibc (the #381/dirsql#189 breakage), the floor is pinned
at link time: the binary runs on every glibc distro since ~2012 *and*
can dlopen. musl-libc distros (Alpine) are unaffected either way — the
synthesized platform packages declare `libc: ["glibc"]`, so npm never
installs them there.

**Required changes.** None. No config keys, inputs, or consumer YAML
change. Consumers whose CLI crate added `vendored`/`bundled` C-source
features for the musl cross-compile may keep them; zig compiles C
source for the gnu target.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- Linux binaries inside `@scope/cli-linux-*-gnu` platform packages
  switch from static-pie musl to dynamically-linked gnu (floor
  `GLIBC_2.17`) on the next release. `dlopen`-dependent features start
  working from the published package.
- The build-time verify step inverts: it previously **asserted** static
  linkage (#384); it now fails on a static binary and additionally
  fails if the binary's max versioned `GLIBC_*` symbol exceeds the
  pinned 2.17 floor — a strictly stronger portability guard than the
  static assert, since it catches runner-glibc linkage exactly.
- The npm lane no longer installs `musl-tools`; it installs
  `cargo-zigbuild` + `ziglang` (pip) on Linux rows instead.

**Verification.** After the first release on this version: `npm install`
the package on Linux, `file` the binary under
`node_modules/@scope/cli-linux-x64-gnu/` (expect `dynamically linked`,
not `static-pie linked`), check `objdump -T <bin> | grep -o
'GLIBC_[0-9.]*' | sort -uV | tail -1` reports ≤ `GLIBC_2.17`, and load
a real extension through the CLI — expect the function to resolve
instead of `Dynamic loading not supported`.
