# New `verify crate` subcommand

**Summary.** `putitoutthere verify crate` joins the `verify` command family
(alongside `verify posture` and `verify npm-tarball`). It reads a published
`.crate` back off the `cargo-http-registry` disk root the engine published
to, extracts it, and asserts the crate's source tree (`src/lib.rs` or
`src/main.rs`) is present — proof the publish shipped real contents, not an
empty or silently no-op'd tarball. This extracts the inline `.crate`
verification bash block the reusable e2e workflow carried
(`e2e-fixture-job.yml`, #334) into one colocated-tested engine command
(epic #442, sub-issue #449); the behavior is unchanged — same crates-row
selection, same present-and-non-empty guard, same error messages. Unlike
the npm sibling, it reads a local disk root (same host, same job), so it
takes `--registry-root <dir>` and performs no HTTP download or retry.

**Required changes.** None. Additive. Consumers compose with the reusable
workflow, not the CLI directly (design-commitment #10); this subcommand is
an internal seam the workflow invokes.

**Deprecations removed.** None.

**Behavior changes without code changes.** None.

**Verification.** With a published `.crate` under `<root>`,
`putitoutthere verify crate --matrix '[{"name":"c","kind":"crates","version":"1.0.0"}]' --registry-root <root>`
prints `ok: <path> contains src/lib.rs or src/main.rs` and exits 0; a
missing/empty `.crate` exits 1 with `no .crate file found (or empty)`, and
a source-less `.crate` exits 1 with
`.crate tarball missing src/lib.rs and src/main.rs`.

---
