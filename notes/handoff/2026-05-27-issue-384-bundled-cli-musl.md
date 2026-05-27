# Handoff: issue #384 — bundled-cli Linux binary glibc regression (PR #386)

**Date:** 2026-05-27  
**Branch:** `claude/bold-hypatia-kTux0`  
**PR:** #386 (draft, waiting for green CI before merge)

---

## What the bug was

`kind = "npm"` `build = "bundled-cli"` Linux binaries shipped dynamically
linked against the build runner's glibc instead of as static musl. The
symptom observed in the wild on `@dirsql/cli-linux-x64-gnu@0.3.11`: the
binary carried a `GLIBC_2.39` symbol requirement and failed at runtime on
Ubuntu 22.04 / Debian 12 / Amazon Linux 2.

Root cause: the engine staged the musl binary into `build/<triple>/`
**before** `npm run build --if-present`. A consumer whose `npm run build`
also ran `cargo build --target $TARGET` (the raw `-linux-gnu` triple) and
copied the result to the same path overwrote the engine's musl binary with
a glibc-linked one. The `bundle_cli — verify` step only checked existence,
so the wrong binary sailed through and was uploaded to the registry.

## What PR #385 got wrong

PR #385 (merged to main before this PR) was "text-matching theater":

- It added a static-linking `file`/`ldd` check to `e2e-fixture-job.yml`'s
  verify step — good — but the step-ordering bug remained. The check runs
  **after** staging, so it would have caught the overwrite… except the
  fixture's `scripts/build.cjs` was a stub that did nothing. The e2e never
  exercised the overwrite scenario.
- It added a unit test that checked `e2e-fixture-job.yml` for the presence
  of `ldd` in the verify step's run block — a string check on YAML text,
  not a behavioral assertion about step ordering.
- The consumer-facing `_matrix.yml` got no static-linking check at all.

## What PR #386 actually fixes

**Two workflow files** (`_matrix.yml` + `e2e-fixture-job.yml`):

- Stage step moved to **after** `npm run build --if-present` in both,
  so the engine's musl binary always overwrites whatever the consumer
  build script staged.
- Static-linking `file`/`ldd` check added to `_matrix.yml`'s verify step
  (mirrors the check that was already in `e2e-fixture-job.yml` after #385).
- `command -v file` guard before both `file` checks — prevents a silent
  false-pass when the `file` binary is absent on a runner.
- `--target-dir target` added to `e2e-fixture-job.yml`'s cargo build step
  (mirrors the #337 fix already in `_matrix.yml`; was a pre-existing gap).

**Unit tests** (`test/workflows/bundle-cli-musl-target.test.ts`):

- New describe: asserts the stage step index is **greater than** the npm
  install+build step index in both `_matrix.yml` and `e2e-fixture-job.yml`.
  This is a structural invariant on the workflow YAML — any regression in
  step ordering is caught at PR time.
- New describe: asserts `_matrix.yml`'s verify step run block matches
  `/ldd|dynamically linked|statically linked|static-pie/i`.

**e2e fixture** (`test/fixtures/js-bundled-cli/`):

- `scripts/build.cjs` (new file): for Linux bundled-cli rows, runs
  `cargo build --release --target x86_64-unknown-linux-gnu --target-dir target-gnu`
  and copies the glibc binary over `build/<triple>/piot-fixture-zzz`. This
  is the real consumer overwrite scenario — not a stub. The fixture's
  `package.json` `build` script calls it so the e2e `npm run build` step
  exercises the overwrite before the engine's stage step runs.
- `putitoutthere.toml` glob narrowed from `scripts/**` to `scripts/build.cjs`.

**README**: Added `[!WARNING]` callout in the bundled-cli recipe warning
consumers not to run `cargo build` in `npm run build` when `[package.bundle_cli]`
is configured.

**CHANGELOG / MIGRATIONS**: Entries under `## Unreleased` with
`(verified by: e2e/js-bundled-cli, unit/bundle-cli-musl-target)`.

## Existing `workflow-yaml-invariants.test.ts` invariant flip

A pre-existing test asserted the stage step was **preceded** by the npm
build step — the exact opposite of the correct ordering. That assertion
was flipped to "followed by" as part of the implementation commit.

## Branch commit history (newest first)

```
a88662d merge: resolve conflicts with main (PR #385 musl verify step)
a22ac02 harden: file-guard, --target-dir target in e2e, narrow glob, dual evidence (#384)
af7726f strengthen: fixture uses real cargo build; README warns against duplicate cargo (#384)
1730aa6 fix: bundle_cli stage binary runs AFTER npm run build (#384)
17f45e8 test: bundle_cli stage binary must run AFTER npm build (#384)
533055e fix: e2e fixture verify step asserts bundle_cli Linux binary is statically linked (#384)
86dd3b2 test: e2e fixture verify step must assert bundle_cli Linux binary is statically linked (#384)
```

The first two commits (`86dd3b2`, `533055e`) were the red/green cycle for
the e2e verify-step check — they overlap with what #385 shipped to main,
hence the merge conflict that was resolved in `a88662d`.

## CI status at handoff

All `js-bundled-cli` build rows (5 targets + main) completed green. Most
other fixtures completed green. A few publish jobs were still in-progress
at time of writing; no failures observed. CodeQL passed.

## What's left

- Wait for full CI green.
- Mark PR #386 ready for review (currently draft).
- Merge.
