# Guidance for LLM agents

This file is the primary instruction set for any LLM (Claude, Codex, Cursor,
etc.) working in this repo. `CLAUDE.md` exists as a Claude-specific entry
point that `@`-includes this file, so edit here — not there.

## Where to put what

- **`README.md`** — the entire user-facing surface. Quickstart, config reference, trailer grammar, trusted-publisher setup, recipes. Edit here when shipping consumer-observable changes.
- **`notes/`** — internal docs. Not user-facing.
  - `notes/design-commitments.md` — non-goals.
  - `notes/internals/` — engine contracts (artifact layout, runner setup) the reusable workflow honors so consumers don't have to.
  - `notes/audits/YYYY-MM-DD-<topic>.md` — post-hoc investigations.
  - `notes/handoff/YYYY-MM-DD-<topic>.md` — handoff briefs.
  - `notes/migrations-pre-rewrite/` — stale per-library adoption plans drafted against the prior hand-written-`release.yml` model. Do not extend.

## Design commitments

Explicit non-goals that bound `putitoutthere`'s scope. Read before proposing
features that expand the tool's surface area.

@notes/design-commitments.md

## Red/green TDD workflow

Behavior changes — bug fixes and new features alike — land in two
phases on the **same PR**, as separate commits. Phase 1 commit
ships only the failing test; phase 2 commit ships the implementation
that turns it green. The mechanics:

1. **Write the test first, at the right tier.** Two test tiers exist
   in this repo:

   - **Unit tests** — `src/**/*.test.ts`, run via `pnpm test:unit`.
     Heavy on mocks (handlers, subprocesses, network) so each suite
     stays fast. Good for branching/orchestration logic; bad at
     catching "the engine never called X" bugs because the X is the
     mock.
   - **Integration tests** — `test/integration/**/*.integration.test.ts`,
     run via `pnpm test:integration`. Mock only the subprocess
     boundary (`execFileSync`, `fetch`). Real config loader, real
     plan, real preflight, real handler dispatch.

   Behavior bugs that show up in the wild — "consumer published a
   broken artifact and we didn't catch it" — almost always belong in
   the integration tier. The bug usually IS that an upstream check
   missed something the downstream subprocess would otherwise have
   complained about; a unit test with a mock handler can't observe
   that miss because the mock handler doesn't perform the check
   either. If you find yourself writing `handlerFor: () => mockHandler`
   to test a "publish should refuse" claim, you're at the wrong tier.

   Commit the test on a branch.
2. **Open the PR with that single commit.** PR title prefixes the
   work with `test:`. PR body explains the bug or missing
   behavior, links the tracking issue, and includes a screenshot or
   paste of the failing CI run so reviewers see the red without
   re-running it locally. Tag with `red-test` so the queue is
   greppable.
3. **Stop.** Wait for review of the test contract. The reviewer's
   job at this stage is to confirm the test exercises the right
   boundary and would actually catch the bug — not to evaluate any
   fix. If the test shape is wrong, fixing it now is cheap; fixing
   it after the implementation lands is not.
4. **After the test contract is approved, push the implementation
   commit on top of the same branch.** Watch the same test go from
   red to green. The implementation commit is where `CHANGELOG.md`
   and `MIGRATIONS.md` updates live (the test-only commit is a
   test-only change and on its own would skip the changelog gate
   per the policy below; the PR as a whole carries the entries).
5. **The PR merges with both commits.** Squash-on-merge collapses
   to one commit on `main`; the two-commit history on the PR
   itself is what gives the workflow its diagnostic power.

This shape exists because skipping phase 1 is the most common way
agent-written PRs ship behavior that doesn't actually fix the
described bug. When the test and the implementation arrive in one
commit, reviewers cannot distinguish "the test would have caught
this without the fix" from "the test was written against the
implementation and passes only because of it." Two separate
commits — the test alone, and then the implementation on top —
make the test's diagnostic power observable: a reviewer can
check out the test commit, run CI, and see the red without the
fix being present.

The pattern applies equally to net-new features: the first commit
defines, in test form, the contract the feature must satisfy.
Reviewers debate the contract before the implementation exists,
when redirecting is cheapest.

Skip the red-test commit only for changes that have no behavioral
contract to test — typo fixes, comment-only edits, dependency
bumps with no code surface change, internal renames the type
checker proves are safe. When in doubt, write the test.

## Changelog and migration policy

Every PR that changes public API **must** update both `CHANGELOG.md` and
`MIGRATIONS.md` in the same PR. This is enforced in CI
(`.github/workflows/changelog-check.yml`). We are not yet strict about
semver, so the bar is deliberately wide: any observable change to consumer
surface — breaking or additive — needs an entry in both files.

"Public API" means anything a downstream consumer can observe:

- The reusable workflow's `workflow_call` inputs and behavior
  (`.github/workflows/release.yml`).
- `putitoutthere.toml` schema — keys, value grammars, defaults, validation
  rules (documented in `README.md`).
- The `release:` trailer grammar (documented in `README.md`).
- Tag format, GitHub Release body shape, and any other artifact a consumer
  workflow might grep.

The CLI, the JS action (`action.yml`), and `src/` exports are **not**
public surface — they're internal seams powering the reusable workflow.
Changes there don't require changelog entries unless they alter the
reusable workflow's externally-visible behavior. See
[`notes/design-commitments.md`](./notes/design-commitments.md) for the
authoritative non-goals.

Purely internal refactors, test-only changes, and docs-only edits do not
require an entry. If CI flags a PR that genuinely has no consumer impact,
add a `skip-changelog:` trailer to a commit in the PR to bypass the check
(any value — the trailer's presence is what matters). For example:

```
Refactor internal plan builder

Pure rename — no observable behavior change.

skip-changelog: internal refactor
```

Use sparingly; the default is to write the entry.

### `CHANGELOG.md`

Keep a Changelog format. New entries go under `## Unreleased`, grouped by
`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed`. Breaking changes
get a `**BREAKING**` prefix and link to their `MIGRATIONS.md` section.

### `MIGRATIONS.md`

Single file at the repo root. New entries go under `## Unreleased`. Each
entry uses this structure:

1. **Summary** — one paragraph: what changed and why.
2. **Required changes** — before/after table covering config, reusable
   workflow inputs, and any consumer-side YAML they need to touch. "None"
   if the change is purely additive.
3. **Deprecations removed** — anything previously warned about that is now
   gone. "None" if nothing was removed.
4. **Behavior changes without code changes** — same API, different runtime
   behavior (tag format, exit codes, retry semantics, default values).
5. **Verification** — what the consumer can observe to confirm the upgrade
   worked (a tag push, a release on GitHub, etc.).

When a version is cut, the release process renames `## Unreleased` to
`## v<OLD> → v<NEW>` in both files and opens a fresh `## Unreleased` block.

