# Issue #428 is already addressed — Cargo workspace version inheritance

**Date:** 2026-07-02
**Issue:** [#428 — Version rewrite can't handle Cargo workspace version inheritance (`version.workspace = true`)](https://github.com/thekevinscott/putitoutthere/issues/428)
**Verdict:** The behavioral defect #428 describes is **already fixed and merged** on `main`. The
pre-build version rewrite follows `version.workspace = true` to the workspace
root, the pre-flight `check` path already resolves the same inheritance, and
both are covered by tests that pass on current HEAD. No further engine change
is required to close #428.

---

## TL;DR

| #428 asks for | Status | Where |
| --- | --- | --- |
| `write-version` (maturin) follows workspace inheritance | ✅ merged | `src/write-version.ts` → `src/write-resolved-cargo-version.ts` |
| `write-crate-version` (bundled-cli / napi) follows it | ✅ merged | `src/write-crate-version.ts` → same resolver |
| Walk to workspace root, rewrite `[workspace.package].version` | ✅ merged | `src/find-workspace-root.ts`, `src/replace-workspace-package-version.ts` |
| Literal single-crate path byte-for-byte unchanged | ✅ merged | resolver falls through to `replaceCargoVersion` |
| Fail loud when neither literal nor resolvable inherited version exists | ✅ merged | `writeResolvedCargoVersion` throw + `replaceCargoVersion` throw |
| CHANGELOG.md + MIGRATIONS.md entries with evidence clause | ✅ merged | `CHANGELOG.md:20`, `MIGRATIONS.md:58` |
| Unit coverage of the resolver + defensive branches | ✅ merged | 5 test files, 17 tests, all green |
| Pre-flight (`check`) understands the same shape | ✅ already present | `src/preflight.ts` (`readWorkspacePackageTable`, `PIOT_CRATES_WORKSPACE_VERSION_MISMATCH`) |
| Fixture + heavy-e2e (real-registry) coverage | ⚠️ not added — see "What is *not* done" | — |
| Plan-time version-lag guardrail | ⏭️ explicitly **optional** in the issue | — |

The fix landed as **PR #431** (squash commit `3451728`, "test: version bump
handles Cargo workspace inheritance (#428) (#431)"), which is an ancestor of
`origin/main`. #428 itself is still open, which is what prompted this audit.

---

## The reported defect

`replaceCargoVersion` (`src/handlers/crates.ts:298`) matches only a literal
quoted `version = "x.y.z"` under `[package]`. A member crate that inherits its
version via `version.workspace = true` has no such literal — the version lives
in a *different file*, the workspace root's `[workspace.package]` table. So both
callers threw `Cargo.toml: no [package].version field found` before the artifact
was ever built:

- `writeVersionForBuild` — the maturin `write-version` path (#276)
- `writeCrateVersionForBuild` — the npm bundled-cli `write-crate-version` path (#366)

This blocks the idiomatic polyglot layout (one Rust core wrapped by a PyO3 wheel
and a napi addon) — the motivating cascade case in
`notes/design-commitments.md`.

## How it is now fixed (merged, on `main`)

The version-write callers no longer call `replaceCargoVersion` directly. Both
delegate to a shared resolver:

- `src/write-version.ts:98` → `writeResolvedCargoVersion(pkgDir, cargoOriginal, version)`
- `src/write-crate-version.ts:51` → `writeResolvedCargoVersion(crateDir, original, version)`

`src/write-resolved-cargo-version.ts` implements exactly the three-way
resolution #428's "Proposed fix" section prescribes:

1. **Literal `[package].version`** → rewritten in place via `replaceCargoVersion`
   (`write-resolved-cargo-version.ts:43-50`). Byte-for-byte identical to the
   pre-#428 single-crate path.
2. **`version.workspace === true`** → `findWorkspaceRoot(crateDir)` walks up to
   the nearest ancestor `Cargo.toml` declaring a `[workspace]` table, and
   `replaceWorkspacePackageVersion` rewrites that root's
   `[workspace.package].version` (`write-resolved-cargo-version.ts:52-62`).
3. **Neither** → fail loud: an inheriting crate with no ancestor `[workspace]`
   throws an actionable error (`write-resolved-cargo-version.ts:53-56`), and a
   genuinely version-less manifest surfaces `replaceCargoVersion`'s existing
   `no [package].version` throw.

Supporting single-function modules, per the repo's one-function-per-file
convention and its synchronous-`node:fs`-only rule (both hold — `readFileSync` /
`writeFileSync` throughout, no `await`ed I/O):

- `src/find-workspace-root.ts` — `findWorkspaceRoot(startDir)`; ENOENT-skip walk,
  malformed-ancestor tolerant.
- `src/replace-workspace-package-version.ts` — the `[workspace.package]` mirror
  of `replaceCargoVersion`, preserving the rest of the file byte-for-byte.

Maturin and cargo both resolve `version.workspace = true` from the workspace
root at build time, so rewriting the root table is sufficient for the produced
wheel / binary to carry the planned version — exactly the mechanism #428 notes.

## Pre-flight already resolves the same shape

Independently of the write path, `putitoutthere check` / the pre-publish
pre-flight already understands workspace inheritance, so a workspace-shaped repo
is not rejected before it reaches the (now-fixed) build step:

- `readWorkspacePackageTable` (`src/preflight.ts:457`) and `resolveInherited`
  (`src/preflight.ts:435`) resolve `<field>.workspace = true` against the
  workspace root's `[workspace.package]` (added for crate metadata in #328).
- `PIOT_CRATES_WORKSPACE_VERSION_MISMATCH` (`src/preflight.ts:784-795`, from
  #301) specifically surfaces `version.workspace = true` with **no** ancestor
  `[workspace.package].version` as a PR-time finding — the "fail loud" case, one
  tier earlier than the build.

So the workspace-inheritance shape is handled consistently across pre-flight
(`check`) and the build-time version rewrite.

## Test evidence (green on current HEAD)

Ran the #428 unit suite on `main`'s HEAD — all pass:

```
✓ src/find-workspace-root.test.ts (4 tests)
✓ src/write-version.test.ts (2 tests)
✓ src/write-crate-version.test.ts (6 tests)
✓ src/write-resolved-cargo-version.test.ts (2 tests)
✓ src/replace-workspace-package-version.test.ts (3 tests)
Test Files  5 passed (5)
     Tests  17 passed (17)
```

Behavior-pinning tests, not just plumbing:

- `src/write-version.test.ts:49` — "rewrites `[workspace.package].version` when
  the maturin crate inherits it (`version.workspace = true`)": builds a
  `[workspace]` + `[workspace.package].version` root with a member declaring
  `version.workspace = true`, asserts the **root** manifest changes and the
  member keeps `version.workspace = true`. This is the exact repro from the
  issue.
- `src/write-resolved-cargo-version.test.ts:29` — "throws when an inheriting
  crate has no ancestor `[workspace]`" (the fail-loud branch).
- `src/find-workspace-root.test.ts` — found-root, no-workspace (`null`),
  malformed-ancestor skip, non-ENOENT read error.
- `src/replace-workspace-package-version.test.ts` — rewrite, same-version no-op,
  missing-`[workspace.package].version` throw.

Pre-flight coverage of the same shape:

- `src/preflight.test.ts:1129` / `:1143` — flags then accepts
  `version.workspace = true` against a workspace ancestor.
- `test/integration/check.integration.test.ts:792` — the integration-tier
  (deterministic CI gate) assertion of `PIOT_CRATES_WORKSPACE_VERSION_MISMATCH`.

## Docs shipped with the fix

- `CHANGELOG.md:20` — `Fixed:` bullet describing the workspace-inheritance
  rewrite, carrying its `(verified by: unit/ubuntu-latest)` evidence clause per
  the verification policy.
- `MIGRATIONS.md:58` — "Version bump follows Cargo workspace inheritance"
  (Summary / Required changes: None / Behavior changes / Verification).

## What is *not* done (and why it doesn't block closing #428)

1. **Fixture + heavy-e2e coverage.** The issue's red/green section also asks for
   a `python-rust-maturin-workspace` fixture wired into the real-registry e2e
   matrix (`e2e-fixture.yml` → `e2e-fixture-job.yml`, mirroring the #276 wheel
   METADATA assertion). PR #431 landed unit coverage only. A steady-state row in
   that matrix performs a **real OIDC publish to PyPI** (`e2e-fixture-job.yml`
   `publish` job), which requires a maintainer-created Trusted Publisher record
   for the new package before it can go green — it cannot be added from an agent
   branch without turning the publish step red, which the repo forbids merging.
   This is fixture/regression hardening, not a correctness gap: the behavior is
   already proven at the unit tier and the pre-flight integration tier.
2. **Plan-time version-lag guardrail.** The issue lists this under "Optional
   follow-up" and states "the rewrite above already makes the shipped artifact
   correct." Not required to close #428.

## Recommendation

Close #428 as resolved by PR #431. If the fixture/e2e hardening in item (1) is
wanted, track it as a separate issue whose landing is staged with the PyPI
Trusted Publisher registration for the new fixture package, so the real-registry
publish row is green from its first run.
