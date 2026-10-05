# New `verify wheel` subcommand

**Summary.** `putitoutthere verify wheel` joins the `verify` command family
(alongside `verify posture`, `verify npm-tarball`, and `verify crate`). It
asserts a built maturin artifact under `<path>/dist` carries the planned
version: a wheel row's first `*.whl` must have a `*.dist-info/METADATA`
`Version:` equal to `--version`, and an sdist row (`--target sdist`) must
produce a `*.tar.gz` whose filename contains it. This extracts the inline
"Verify wheel/sdist version matches matrix.version" bash block the reusable
e2e workflow carried (`e2e-fixture-job.yml`, #276) into one colocated-tested
engine command (epic #442, sub-issue #450); the behavior is unchanged — same
file selection, same error/ok messages, same exit code. The wheel's METADATA
is read with a dependency-free pure-Node zip reader (no `unzip`), so the
command runs on every platform the maturin matrix builds on.

**Required changes.** None. Additive. Consumers compose with the reusable
workflow, not the CLI directly (design-commitment #10); this subcommand is
an internal seam the workflow invokes.

**Deprecations removed.** None.

**Behavior changes without code changes.** None.

**Verification.** With a maturin build under `<path>/dist`,
`putitoutthere verify wheel --path <path> --version <v> --target <triple>`
prints `ok wheel: <name>.whl METADATA Version=<v>` and exits 0 when the
wheel carries `<v>`; a mismatch exits 1 with
`wheel METADATA Version='<actual>' but plan='<v>'`. `--target sdist` checks
the sdist filename instead (`ok sdist:` / `does not contain planned
version`).

---
