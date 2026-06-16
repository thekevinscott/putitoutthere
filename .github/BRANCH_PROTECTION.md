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
- Required status checks — add **all** of these:
  - `CI Gate` — the `thekevinscott/pr-monitor` aggregator. Covers the
    fast checks (lint, unit, coverage, …) and the path-filtered ones
    (`actionlint`, Link check) that can't be required individually.
    Keep it required, but it is **not sufficient on its own** — see
    "Why `CI Gate` alone isn't enough" below.
  - `integration`
  - `e2e (CLI, live registries)`
  - `patch-coverage`
  - `Changelog check`
  - `Evidence check`

The five contexts beside `CI Gate` are named explicitly because the
aggregator can race past them (see below). They run on every PR, so
requiring them never blocks a merge on a check that didn't fire.

Do **not** add the path-filtered checks (`actionlint`, Link check) as
required status checks: they run only when workflow or `*.md` files
change, and a required check that never reports leaves the PR stuck on
"Expected — Waiting for status to be reported." `CI Gate` covers those
when they run.

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

## Why `CI Gate` alone isn't enough

`CI Gate` runs `thekevinscott/pr-monitor@v1`. It polls the PR's check
runs and turns green when nothing is in progress and nothing failed —
but its loop only re-fetches the check list **while at least one check
is in progress**. The instant every check that has *registered so far*
is terminal, the loop exits, even if heavier jobs haven't created their
check runs yet.

On this repo the fast jobs (lint, unit, coverage) register and finish
in a tight window, while `integration`, `e2e (CLI, live registries)`,
and the `e2e (…)` fixture matrix register later (heavier setup, runner
queueing). If the fast wave drains before the heavy wave registers,
pr-monitor sees nothing in progress and reports success. This is not
hypothetical: across the #403 epic's five red, test-only commits,
`CI Gate` went green while `integration` and `e2e (CLI, live
registries)` were `failure`, and on a docs PR it concluded in ~1.7 min,
before the fixture suite started (#417).

`pr-monitor@v1` exposes no "minimum checks" or explicit-required-set
input to close this race, and raising `pre-sleep` can't bound runner-
queue latency. So the durable fix is to require the affected contexts
explicitly, as above. (A maintainer who wants zero reliance on the
aggregator can instead require every always-on context explicitly and
drop `CI Gate`; the trade-off is that adding a new always-on workflow
then means editing branch protection again.) If pr-monitor later grows
a reliable wait-for-this-set input, the single-`CI Gate` model can be
restored in its own change.

## Required workflows in practice

These run on every PR and gate merge. "Gated via" shows whether branch
protection blocks on the check directly (explicitly required) or only
through the `CI Gate` aggregator:

| Check (context name) | Workflow file | Gated via |
|---|---|---|
| `eslint` (typecheck + ESLint) | `lint.yml` | CI Gate |
| `unit (ubuntu-latest)` / `(macos-latest)` / `(windows-latest)` | `test.yml` | CI Gate |
| `coverage` | `coverage.yml` | CI Gate |
| `require-tests` (TDD lint) | `tdd-lint.yml` | CI Gate |
| CodeQL (`analyze`) | `codeql.yml` | CI Gate |
| `gitleaks` (secret scan) | `secret-scan.yml` | CI Gate |
| `integration` | `integration.yml` | **explicit** |
| `e2e (CLI, live registries)` | `e2e-cli.yml` | **explicit** |
| `patch-coverage` | `patch-coverage.yml` | **explicit** |
| `Changelog check` | `changelog-check.yml` | **explicit** |
| `Evidence check` | `evidence-check.yml` | **explicit** |

Path-filtered — run only on matching diffs, so they are covered by
`CI Gate` when they fire and are never required individually:

| Check (context name) | Workflow file | Runs when |
|---|---|---|
| `actionlint` | `actionlint.yml` | `.github/workflows/**` changes |
| `lychee` (link check) | `link-check.yml` | `**/*.md` changes |

The `e2e (…)` fixture matrix (`e2e-fixture.yml`) also runs on every PR
and exercises real OIDC publishes (TestPyPI). It is currently gated
only through `CI Gate`, so the race above can let it slip; promoting
its contexts to explicitly-required is a heavier, publish-bound call
left to the maintainer. (The older note that the fixture suite is
`workflow_dispatch`-only is stale — it triggers on `pull_request`.)

`release-npm.yml` triggers on tag push only and does not run on PRs.

## Why require-up-to-date

Forces every PR to rebase onto main before merge. This matters for the
`CI Gate` aggregator: a PR's checks need to have run against the full
merged state, not a behind-main snapshot. Otherwise a benign-looking
merge can land a regression CI never saw.
