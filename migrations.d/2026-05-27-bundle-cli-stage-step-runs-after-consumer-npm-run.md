# `bundle_cli` stage step runs after consumer `npm run build`

**Summary.** The engine's `bundle_cli — stage binary` step previously ran
**before** `npm run build --if-present`. A consumer build script that also
runs `cargo build --target $TARGET` (the raw `-linux-gnu` triple) and copies
the result to `build/<triple>/` would overwrite the engine's musl binary with
a glibc-linked one; the existence-only verify check passed and the
dynamically-linked artifact shipped to the registry. The stage step now runs
**after** `npm run build --if-present` so the engine's statically-linked musl
binary always wins. The `bundle_cli — verify` step in `_matrix.yml` now also
asserts static linking (`file`/`ldd` check), mirroring the check already
present in `e2e-fixture-job.yml`.

**Required changes.** None — this is a pure step-reordering inside the
reusable workflow. No consumer-side YAML, config, or scripts need to change.

**Deprecations removed.** None.

**Behavior changes without code changes.** Consumer build scripts that stage
a binary to `build/<triple>/` as part of `npm run build` will have that binary
overwritten by the engine's musl binary. This was always the intended behavior;
the old ordering was a bug. Consumer scripts that only compile TypeScript or
do non-binary work are unaffected.

**Verification.** A `bundle_cli` Linux build job's logs now show:
1. `bundle_cli — cargo build for <triple>` (musl build, unchanged)
2. `npm run build --if-present` (consumer build step)
3. `bundle_cli — stage binary into build/<triple>` (engine stages musl binary)
4. `bundle_cli — verify … is statically linked` (passes)
