# New `verify bundle-cli` subcommand

**Summary.** `putitoutthere verify bundle-cli` completes the `verify` command
family (alongside `verify posture`, `verify npm-tarball`, `verify crate`, and
`verify wheel`). It asserts a maturin bundled-CLI wheel under `<path>/dist`
contains its cross-compiled binary at a path ending `<stage_suffix>/<bin>`,
where `stage_suffix` is `--stage-to` with `[tool.maturin].python-source` (or
the legacy `python_source`) subtracted from the front, and `<bin>` gains a
`.exe` suffix on a Windows `--target`. It codifies, as one colocated-tested
engine command, the inline "bundle_cli — verify wheel contains
`<stage_to>/<bin>`" bash block the reusable release workflow carries
(`_matrix.yml`, #282/#358); the behavior is unchanged — same wheel selection,
same python-source stripping, same match, same error messages and exit code.
The wheel is read with the same dependency-free pure-Node zip reader as
`verify wheel` (no `unzip`), so it runs on every platform the maturin matrix
builds on, Windows included. Unlike the earlier siblings' single copies —
which lived in `e2e-fixture-job.yml`, a workflow that runs `node
dist/cli-bin.js verify …` directly — this check's only copy lives in
`_matrix.yml`, which invokes the engine solely via `action.yml` (no `verify`
surface) and builds no `dist/`; that inline copy therefore stays in place
until the reusable workflow gains a way to call the engine, with the tested
command as the single source of truth going forward.

**Required changes.** None. Additive. Consumers compose with the reusable
workflow, not the CLI directly (design-commitment #10); this subcommand is
an internal seam.

**Deprecations removed.** None.

**Behavior changes without code changes.** None.

**Verification.** With a maturin bundled-CLI wheel under `<path>/dist`,
`putitoutthere verify bundle-cli --path <path> --stage-to <dir> --bin <name> --target <triple>`
prints `ok bundle_cli: <stage_suffix>/<bin> present in <wheel>` and exits 0
when the binary is staged; a wheel missing it exits 1 with `wheel <name>
missing bundle_cli binary at <stage_suffix>/<bin>` followed by a `wheel
contents:` listing, and a package with no wheel under `dist/` exits 1 with
`no wheel produced under <dir>`.

---
