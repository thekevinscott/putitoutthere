# pypi bundle_cli binaries are dynamically linked (gnu) again

**Summary.** The pypi `[package.bundle_cli]` lane no longer applies the
#381 gnu→musl mapping: the bundled CLI binary staged into each Linux
wheel is compiled against the package's declared `*-linux-gnu` triple
and is dynamically linked. A static-pie musl binary cannot `dlopen`, so
SQLite extension loading (and any other runtime `dlopen`) from the
published wheel failed with `Dynamic loading not supported`
(dirsql#755). The wheel's manylinux platform tag already gates installs
to the glibc floor of runner-built artifacts, so the dynamic binary has
exactly the wheel's own reach. (The npm bundled-cli lane has since
followed via zigbuild — see the section above.)

**Required changes.** None. No config keys, inputs, or consumer YAML
change. Consumers whose CLI crate added `vendored`/`bundled` C-source
features solely to satisfy the musl cross-compile (e.g. `libsqlite3-sys`
`bundled`) may keep them; they build fine against gnu.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- The bundled binary inside Linux wheels switches from static-pie musl
  to dynamically-linked gnu on the next release. `dlopen`-dependent
  features (SQLite extension loading) start working from the published
  wheel.
- The binary now carries the build runner's glibc requirement — the
  same floor the wheel's manylinux tag already enforces at install
  time, so installable-but-unrunnable combinations do not arise on the
  current runner layout.
- The pypi lane no longer installs `musl-tools`; crates with C source
  deps compile with the host gnu toolchain.

**Verification.** After the first release on this version: download the
Linux wheel from PyPI, `unzip`+`file` the staged binary (expect
`dynamically linked`, not `static-pie linked`), and load a real
extension through the installed CLI, e.g. `uvx --with sqlite-vec
<pkg> query "SELECT vec_version()"` with a `[[<pkg>.extension]]`
config entry — expect the function to resolve instead of
`Dynamic loading not supported`. Downstream, dirsql#761's PR-time
extension-load probe performs exactly this check against the
release-shape wheel.
