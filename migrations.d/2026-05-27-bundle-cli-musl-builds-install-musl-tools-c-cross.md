# `bundle_cli` musl builds install `musl-tools` C cross-compiler

**Summary.** `rustup target add x86_64-unknown-linux-musl` registers the
Rust musl target but does not install the C cross-compiler
(`x86_64-linux-musl-gcc`). Crates that compile C source at build time —
`libsqlite3-sys` with `features = ["bundled"]`, `openssl-sys` with
`features = ["vendored"]`, and similar — invoke the C compiler directly
during `cargo build`; without `musl-gcc` present, the build fails with:

```
failed to find tool "x86_64-linux-musl-gcc": No such file or directory
```

The `musl-tools` apt package provides `musl-gcc` and is not pre-installed
on `ubuntu-latest`. `_matrix.yml` and `e2e-fixture-job.yml` now run
`sudo apt-get install -y musl-tools` and export `CC_<triple>=musl-gcc` to
`$GITHUB_ENV` before `cargo build`, gated on Linux targets.

**Required changes.** None — the step is added automatically by the
reusable workflow.

**Deprecations removed.** None.

**Behavior changes without code changes.** CLI crates that compile C
source and previously had to run a custom `build` script to install
`musl-tools` may be able to remove that script.

**Verification.** On a bundle_cli Linux build, the workflow now prints
`sudo apt-get install -y musl-tools` before the `cargo build` step.
Crates with C deps (e.g. `features = ["bundled"]` on `rusqlite`) compile
successfully without consumer-side workarounds.
