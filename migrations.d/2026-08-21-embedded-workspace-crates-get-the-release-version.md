# Embedded workspace crates get the release version

**Summary.** A released wheel or napi addon that compiles a sibling Rust
crate **by path** used to ship that crate's stale on-disk version (issue
#621). The three pre-build writers each bumped only the crate the build
tool reads as its version source — maturin's `matrix.path`,
`bundle_cli.crate_path`, the napi crate — which answers *"what version is
this artifact?"* but not *"whose `CARGO_PKG_VERSION` is observable from
it?"* When the CLI lives in a core crate that the pyo3 extension module
and the napi addon each pull in by path, the core owns the
version-bearing symbol and nothing bumped it, so `--version` reported
whatever literal was last committed by hand. The crates.io lane was
unaffected, because there the published crate *is* the symbol's owner —
which is why `cargo install` was right while the wheel and the npm
package were wrong. The bump now walks the path-dependency graph out of
the crate being built and stamps the artifact's release version into
every in-repo crate it reaches, along with every in-repo version
requirement pointing at them.

**Required changes.** None. This is automatic and needs no configuration.

The one thing worth knowing is that `version.workspace = true` is no
longer needed as a workaround for this. A core crate that also publishes
to crates.io can keep the explicit `[package].version` literal the crates
handler requires.

**Deprecations removed.** None.

**Behavior changes without code changes.**

- Every in-repo crate reachable by path from the crate being built is
  rewritten to the release version before the build, so the compiled
  artifact reports the version of the artifact you installed from every
  surface it exposes — `__version__`, `--version`, and any constant baked
  from `CARGO_PKG_VERSION`, including one used as a cache key.
- Version **requirements** pointing at those crates are rewritten too, in
  `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`,
  `[target.'cfg(…)'.dependencies]` and `[workspace.dependencies]`. Without
  this the bump would break the build outright: a `version = "0.2"`
  requirement stops matching once its dependency moves past it and cargo
  refuses to resolve (exit 101) before anything compiles.
- Registry dependencies are never rewritten, and a workspace member that
  nothing in the artifact depends on is left alone — reachability from the
  built crate is the criterion, not workspace membership.
- A crate kept on a deliberately separate version line from the artifact
  embedding it will now report the **artifact's** version from inside that
  artifact. This is the intended semantics: the artifact's version is the
  only one a user can verify against what they installed. It does not
  affect what that crate publishes to crates.io, which still comes from
  its own plan on its own tag.
- All rewrites are ephemeral. They happen in the build job, whose checkout
  is discarded; `publish` runs in a separate job from a fresh checkout, so
  nothing here reaches a published manifest or the crates handler's
  dirty-tree check.

**Verification.** Release any version greater than the core crate's
on-disk literal, install the wheel or npm package, and run the CLI:

```console
$ pipx run <your-package> --version
<your-package> 0.4.2
```

The printed version should equal the version you installed, and should
match what `cargo install` reports for the same release. Before this
change it reported the literal committed in the core crate's
`Cargo.toml`.

---
