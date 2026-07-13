# Audit: how `integration lint` discovers its subjects (and how I got it wrong)

**Date:** 2026-07-13
**Context:** scoping gate 3 (`integration-lint`) of the engine's
testing-conventions adoption (epic #474).
**Purpose:** record a wrong conclusion I reached, the reasoning that led
there, and the specific `testing-conventions` doc ambiguities that misled
me — so the upstream docs can be clarified.

## The wrong conclusion

While scoping gate 3 I told the maintainer:

> integration-lint can't meaningfully cover the engine: its 23 integration
> tests live in `test/integration/` (outside the `src` scan root), so
> enabling the gate is a no-op. They're already lint-clean.

And I proposed, as the way to get real coverage, **relocating the 23
integration tests into `src/`** (colocating them like unit tests).

Both the mechanism and the remedy are wrong:

- **Mechanism — wrong.** `integration lint` never scans `source`/`src` for
  integration tests, so "outside the `src` scan root" is not why the gate is
  empty. It derives the **package root** from the path it's given and looks
  for integration tests at `<package root>/tests/integration/`.
- **Remedy — backwards.** The convention wants integration tests in
  `tests/integration/`, *not* in `src/`. Colocating them in `src/` is the
  opposite of what the standard asks for.
- **Conclusion — right by accident.** Enabling the gate today *is* a no-op,
  but not for the reason I gave. The real reason is a directory-name
  mismatch: the engine keeps these tests in `test/` (**singular**), and the
  tool discovers them only under `tests/` (**plural**).

## Ground truth (verified)

`integration lint <PATH>`:

1. Walks **up** from `<PATH>` to the nearest package root (the directory
   holding `package.json`).
2. Takes its subjects from `<package root>/tests/integration/` and
   `<package root>/tests/e2e/` — **plural `tests`**.
3. Does **not** recursively scan `<PATH>` itself for integration tests.

The reusable workflow passes `SCAN_PATH = inputs.source`
(`packages/engine/src` for the engine) as `<PATH>`, so discovery resolves to
`packages/engine/tests/integration/`.

### Evidence

A first-party mock in an integration test is a `no-first-party-mock`
violation, so it's a clean discovery probe — if the tool sees the file, it
flags it.

| Probe location | Invocation | Result |
| --- | --- | --- |
| `packages/engine/test/integration/` (singular) | `integration lint --language typescript packages/engine/src` | **EXIT 0** — not discovered |
| `packages/engine/test/integration/` (singular) | `integration lint --language typescript packages/engine/test/integration` (path pointed *directly* at the folder) | **EXIT 0** — still not discovered |
| `packages/engine/tests/integration/` (plural) | `integration lint --language typescript packages/engine/src` | **FLAGGED** `no-first-party-mock` (EXIT 1) |

The middle row is the decisive one: pointing the `<PATH>` argument straight
at the singular `test/integration` folder *still* found nothing, because the
tool walked up to the package root and looked in `tests/` (plural). The
`<PATH>` argument selects a package root; it is not the scan target.

## What misled me

Two doc surfaces point in different directions, and I trusted the wrong one.

1. **CLI help contradicts the explanation.** `integration lint --help`
   describes the positional argument as:

   > `<PATH>`  Directory to scan recursively for test files

   That plainly says "the directory you pass is scanned recursively." The
   [Isolation / Integration explanation](https://thekevinscott.github.io/testing-conventions/explanation/isolation)
   says the opposite of what that implies about *location*:

   > `integration lint` takes its subjects from `<package root>/tests/integration/`
   > and `<package root>/tests/e2e/` … a test file under `tests/` outside a
   > standard tier is flagged (`unknown-tier`).

   "Scan `<PATH>` recursively" and "take subjects from `<package
   root>/tests/integration/`" are two different discovery models. Reading the
   CLI help plus the reusable workflow's `SCAN_PATH = source`, I built the
   mental model "it scans `source` recursively" — and concluded the engine's
   `test/` tree, being outside `source`, was invisible to it. The help text
   should say the argument is used to locate the package root, and that
   integration/e2e subjects are read from `<package root>/tests/{integration,e2e}/`.

2. **The plural-`tests/` requirement isn't surfaced where the mistake
   happens.** Nothing in the CLI help, nor in the reusable workflow's
   `source` input description, states that the integration/e2e tiers must
   live under **`tests/`** (plural). A repo using **`test/`** (singular) — a
   common layout — gets **zero integration coverage behind a green check**,
   silently. There is no "0 integration files found" notice and no warning
   that a sibling `test/` directory was ignored. Silent-green is the
   dangerous failure mode: the gate looks adopted but enforces nothing.

3. **`source` overloads two roles.** `source` is (a) the recursive scan root
   for the unit/colocated gates *and* (b) the seed for package-root
   derivation used by the integration/e2e gates. Because the workflow feeds
   the same value to every gate's `SCAN_PATH`, it's natural to assume all
   gates scan `source`. They don't — the integration/e2e gates only use it to
   find the package root.

## Suggested upstream doc fixes

- Rewrite the `integration lint` (and `e2e`) `<PATH>` help text: it selects a
  **package root**; subjects come from `<root>/tests/integration/` and
  `<root>/tests/e2e/` (plural `tests`). It is not a recursive scan of `<PATH>`.
- State the plural-`tests/` requirement at every point of use (CLI help,
  reusable-workflow `source` description, adoption guide), and call out that a
  singular `test/` directory is **not** discovered.
- Emit a visible notice when an integration/e2e gate runs but discovers zero
  subject files, so "adopted but empty" can't hide behind a green check.
  (This is the same class of gap as putitoutthere #512: a gate that passes
  while covering nothing.)

## Corrected implication for the engine's gate 3

The engine's 23 integration tests are already `integration-lint`-clean; the
only blocker is location. The correct path to real coverage is **not**
moving them into `src/` — it's aligning the directory with the convention:

- Rename `packages/engine/test/` → `packages/engine/tests/` (plural), which
  makes `tests/integration/` (23 files) and `tests/e2e/` (11 files)
  discoverable.
- Handle the non-tier test files that would then sit under `tests/` and trip
  `unknown-tier`: `tests/workflows/` (12 `.test.ts`) and the 2 `.test.ts`
  under `tests/fixtures/`. These are the repo's workflow-contract tier, not
  integration/e2e, so they need a home the tool accepts (relocate, or an
  agreed exemption).
- Update every reference to the `test/` path (vitest projects, `package.json`
  scripts, tsconfig, imports).

That is a real, scoped change — larger than a burndown, smaller than the
`src/` relocation I wrongly proposed — and it's tracked separately from this
audit.
