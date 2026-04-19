# Branch protection

This repo requires branch protection on `main` for autonomous review +
merge to be trustworthy. Configure the following once, in the GitHub UI
at `Settings → Branches → Add rule` (branch pattern: `main`).

## Required settings

**Rule name:** `main`

**Require a pull request before merging** ✓
- Require approvals: 1 (or 0 if truly solo — the bot approves itself otherwise)
- Dismiss stale pull request approvals when new commits are pushed ✓
- Require review from Code Owners: optional

**Require status checks to pass before merging** ✓
- Require branches to be up to date before merging ✓
- Required status checks:
  - `CI Gate` (only this one — aggregates every other check via `clankerbot/pr-monitor`)

Do **not** enumerate each workflow individually. The aggregator turns
green only when every other required check passes, so adding a new
workflow doesn't require editing branch protection.

**Require conversation resolution before merging** ✓

**Require signed commits** — optional; recommended.

**Require linear history** ✓
- Keeps the graph readable. All PRs are squash-merged.

**Restrict who can push to matching branches**
- Include administrators ✓ (applies the rule to everyone, no bypass)

**Allow force pushes:** ❌
**Allow deletions:** ❌

## Tag protection

Tag protection for release tags (`v*.*.*`) is separate. Under
`Settings → Tags → New rule`:

- Pattern: `v*.*.*`
- Allowed actors: repository admins + the release workflow
  (`release-npm.yml` authored commits)

This prevents accidental tag overwrites that would re-publish a
version or break OIDC trust chains on crates.io / PyPI.

## Required workflows in practice

With the rule above in place, these workflows all run on every PR and
must pass for CI Gate to go green:

| Workflow | File | Blocks merge |
|---|---|---|
| Lint (typecheck + eslint) | `lint.yml` | ✓ |
| Tests (unit on ubuntu/macos/windows) | `test.yml` | ✓ |
| Coverage (≥90% global) | `coverage.yml` | ✓ |
| Bundle (`dist-action/` up to date) | `bundle.yml` | ✓ |
| TDD lint (tests required for `src/` changes) | `tdd-lint.yml` | ✓ |
| Actionlint (workflow YAML) | `actionlint.yml` | ✓ (when workflow files change) |
| CodeQL (security) | `codeql.yml` | ✓ |

`e2e.yml` is `workflow_dispatch`-only by design (§23.4) and does not
gate merge.

`release-npm.yml` triggers on tag push only and does not run on PRs.

## Why require-up-to-date

Forces every PR to rebase onto main before merge. This matters for the
`CI Gate` aggregator: a PR's checks need to have run against the full
merged state, not a behind-main snapshot. Otherwise a benign-looking
merge can land a regression CI never saw.
