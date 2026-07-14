# Handoff — 2026-07-14: open issues + testing-conventions state

Context for the next agent picking up `putitoutthere`. Written after epic
**#442 closed** and the testing-conventions adoption (#474) reached its
final stretch. Read `AGENTS.md` first — this brief assumes it.

## TL;DR of where things stand

- **Epic #442 (extract inline `run:` bash → tested TS) is DONE and closed.**
  All 17 sub-issues merged. The `run:`-holds-no-logic rule is enforced
  repo-wide; repo-internal gates live in `packages/ci/src/<gate>/` invoked
  via the `piot-ci` bin; the `test/workflows/` text-contract tier shrank to
  only the invariants that earn their place.
- **Epic #474 (adopt testing-conventions) is the one live workstream**, and
  close to done. `packages/ci` is at full standard; the engine (#476) has
  gates 1–3 on with **4–7 remaining**.
- Recent merges (2026-07-14): **#528** (#467 dogfood bin), **#529** (#468
  patch-coverage → `src/ci/`), **#530** (#518 test-layout, no-exemptions).
- **7 issues open.** Full triage below.

## What just landed in this session (so you don't re-derive it)

- **#530 / #518 — test-layout, no exemptions.** The engine test tree is now:
  plural `packages/engine/tests/` holds tier-able suites (`integration/`,
  `e2e/`, fixture **data** under `tests/fixtures/`, `tests/setup.ts`);
  **singular `packages/engine/test/workflows/`** holds the not-yet-dissolved
  workflow-contract text tests + `consumer-template.test.ts`. There is **no
  `testing-conventions.toml`** — the workflow-contract tests live in singular
  `test/` precisely because the tool doesn't scan it, so `unknown-tier` has
  nothing to flag and no waiver is needed. The maintainer's directive was a
  hard **"No exemptions please"**; honor it. The tension it resolves: you
  cannot have all of {no exemptions, one `tests/` tree, keep the earned
  workflow-contract tests} — so singular `test/workflows/` survives until
  #442/#448's dissolution work (already done for the extracted gates; the
  residual earned tests stay).

## Open issues — triage (recommended order)

### 1. #512 — wire `coverage`/`patch-coverage` into the CI Gate aggregator  ← do first
Real "no release surprises" hole. Those checks can be **red while
`mergeable_state: clean`**, so a coverage regression auto-merges to `main`
(happened once: branch coverage slipped to 90.96%). Fix: make them required
inputs to `.github/workflows/ci-gate.yml`. Small, high-value, and protects
every other PR — especially given how much this repo leans on auto-merge.

### 2. #476 — finish engine testing-conventions gates 4–7  (sub-issue of #474)
Gates 1–3 live (`colocated-test`, `unit-lint`, `integration-lint`).
Remaining, each an S/M PR via the `gates:` input in `conventions.yml`:
- **gate 4 `unit-coverage`** (100% floor) — #518 cleared the vitest-layout
  runway for exactly this; it's the natural next pick.
- **gate 5 `mutation`** (changed-line survivors → 0)
- **gate 6 `packaging`** (no test files in tarball; engine ships
  `files: ["dist"]`, so likely already clean — quick)
- **gate 7** remove the `gates` flag → full standard, no config.
Closing gate 7 closes #476, which closes epic **#474**.

### 3. #456 — maturin workspace-inheritance fixture evidence
Not a live bug. The `version.workspace = true` resolver is fixed +
unit-covered (#428/#431), but the changelog cited `unit/`, not the
integration/e2e wheel evidence the issue wanted. Add a `[workspace]`-shaped
maturin fixture asserting the built wheel's `.dist-info/METADATA` `Version ==
planned`. Opportunistic — do it when next in the fixture suite.

### 4. #461 — post-release hook/callback  (NEEDS A PRODUCT RULING)
Do **not** just implement this. It brushes design-commitment non-goals **#4
(no build escape hatches / hooks)** and **#6 (no changelog generation)**. The
issue argues the *timing + facts of a release* are something only the
pipeline knows (a real distinction from arbitrary hooks), motivated by
dirsql's changelog-fragments assembly. Get an explicit in-scope/out-of-scope
ruling from the maintainer against the non-goals **before** any design.

### 5. #440 — unpin e2e `npm@11` → latest.  Revisit **2026-08-09**.
Pinned around npm/cli#9722 (npm 12's bundle missing `sigstore` breaks
`--provenance`). Has a self-contained checklist. Nothing to do until the
date; don't let it become silent archaeology.

### 6. #469 — Epic: migrate engine sync → async `node:fs`  (DORMANT; needs intent)
Skeleton, no sub-issues. **Explicitly reverses** the AGENTS.md "sync
throughout, by design" commitment, and its own first task (fill in *why the
tradeoff changed* in AGENTS.md) is still a `TBD` placeholder. Do not move it
until the maintainer decides it's wanted and supplies the justification —
right now it contradicts a documented, reasoned commitment.

(#474 itself stays open as the tracking epic until #476 lands.)

## Conventions & gotchas the next agent MUST honor

- **No exemptions.** Never add a `testing-conventions.toml` / `exempt` entry.
  Fixes go in the code (or, for genuinely non-tier tests, in singular `test/`
  which the tool doesn't scan).
- **Never author auto-merges.** The maintainer manages merging (they operate
  as `thekevinbot`; webhook actor attribution is unreliable). Flow ends at:
  push → drive required CI green → hand off. Do **not** call
  `enable_pr_auto_merge`; do **not** merge PRs yourself.
- **Never set a PR to draft.** This repo doesn't use drafts. Open PRs ready.
- **Red/green TDD, two pushes.** Behavior changes: push the test-only commit
  first, observe it RED in CI (the specific new test, not a lint/flake), then
  push the impl. Never batch both in one push. Refactors/test-layout/dep-pins
  are exempt (no behavioral contract).
- **`packages/ci` gate pattern.** Each gate = `src/<gate>/` with an I/O-free
  `decide.ts` (pure `{exitCode, lines}`) + thin `run.ts` composition root
  (only env/`execFileSync`/`readFileSync`) + colocated `decide.test.ts` &
  `run.test.ts` (mocks BOTH the OS boundary AND `./decide.js`) + a
  `tests/integration/<gate>.integration.test.ts` (real `run()`, only OS
  boundary mocked) + dispatch in `cli.ts`. One function per file.
- **Mutation gate (`testing-conventions unit mutation --base origin/main
  packages/ci/src` → 0 survivors).** Runs on COMMITTED state (commit before
  running). Avoid regex quantifiers (`.+`/`.*`) — unkillable equivalent
  mutants; use fixed-string `startsWith`/`slice`/length checks + exact
  assertions (`toEqual` whole objects).
- **Windows unit matrix + isolation-lint.** In engine `src/` impl, build
  paths with forward-slash **string concatenation**, not `path.join` (→
  backslashes on Windows). Do NOT import `node:path` into a unit test (unmocked
  collaborator → isolation-lint fail); assert literal forward-slash strings.
- **`maxBuffer`.** `execFileSync(..., {encoding})` capturing large output
  needs `maxBuffer: 64*1024*1024` (default 1 MiB → `ENOBUFS`; maturin's simple
  index is ~1.15 MiB). This was a real bug (#527) a mock couldn't catch — it's
  why the repo runs e2e in CI rather than attesting.
- **Parallel agents that write files MUST use `isolation: "worktree"`** or
  they collide in the shared checkout.
- **Never rename a release-path workflow file** (`e2e-fixture.yml`,
  `e2e-fixture-job.yml`, `release*.yml`) — TP records encode the filename.
- **Changelog/evidence gates.** Consumer-surface changes need `CHANGELOG.md` +
  `MIGRATIONS.md` entries with a `(verified by: …)` clause. Internal-only
  (CLI/`src/`/`action.yml`/CI gates) don't — use `skip-changelog:` trailer +
  the entry's not needed. Most of this workstream is internal → `skip-changelog`.
- **The flaky heavy suite** (`e2e-fixture.yml` / `e2e-fixture-job.yml`, real
  OIDC publishes) is **NOT a required merge gate**. Required gates are the
  deterministic ones (Conventions, unit, integration, changelog, evidence,
  patch-coverage, CI Gate). Never merge on red required checks; treat
  external-looking failures as real until proven otherwise.

## Branch / process notes

- Designated dev branch pattern for this program of work has been
  `claude/epic-<N>-*`. Epic #442's branch is merged — start follow-up work
  from latest `origin/main` on a fresh branch; do not stack on merged history.
- In this remote/hosted env, open a PR as soon as the first commit is pushed
  (the PR is the maintainer's only view). Put `Closes #<N>` in the PR **body**
  so the issue auto-closes on merge (a `(#N)` in the title closes nothing).
- Ephemeral container: anything not pushed is lost.

## Suggested first move

**#512** (close the auto-merge coverage hole — small, protects everything),
then **#476 gate 4 `unit-coverage`**. #461 and #469 are blocked on maintainer
rulings; #440 is a calendar item (Aug 9); #456 is opportunistic.
