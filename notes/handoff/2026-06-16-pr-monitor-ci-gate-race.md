# Handoff — `pr-monitor` reports green before all checks finish (CI Gate race)

**Date**: 2026-06-16
**Outgoing agent**: Claude (session `01Wh3vNXdiFVak9K1bK3c17f`)
**Incoming**: whoever picks this up **in `thekevinscott/pr-monitor`** — the fix lives there, not here.
**Origin**: putitoutthere issue [#417](https://github.com/thekevinscott/putitoutthere/issues/417) (closed) and the withdrawn PR [#418](https://github.com/thekevinscott/putitoutthere/pull/418) (closed — it took a wrong approach; see "Rejected fixes").

This is a **`pr-monitor` bug**, not a putitoutthere code change. putitoutthere consumes `pr-monitor` as its one required status check (`CI Gate`, via `.github/workflows/ci-gate.yml`). Nothing in putitoutthere needs to change once `pr-monitor` is fixed except, possibly, bumping the pinned version.

---

## TL;DR

`pr-monitor` decides "all checks passed" by polling the **check-run** list (`checks.listForRef`) and concluding the moment **nothing is currently in progress**. But the check-run list is *incomplete and gappy while a build is fanning out*: jobs that are `needs:`-gated or still queued behind a busy runner pool have **no check run yet**. So "nothing in progress right now" is not the same as "everything has run" — and when those two states coincide with the fast checks already being done, `pr-monitor` exits **green while heavier jobs have not started/finished**.

The fix is to monitor **workflow runs** (`actions.listWorkflowRunsForRepo({head_sha})`) instead of check runs. The set of workflow runs is **complete at push time** and a run stays non-terminal until *all* its jobs (including `needs:`-gated and reusable-workflow children) finish. This closes the race **without** a static minimum-check count and **without** enumerating checks in branch protection — both of which break the "one dynamic gate" design.

---

## Symptom (as reported on #417)

`CI Gate` is the single required status check on putitoutthere's `main`. It is supposed to turn green only when every other check on the PR has passed. It doesn't reliably do that:

- Across the #403 epic's **five** deliberately-red, test-only commits (#404 / #409 / #411 / #413 / #415), `CI Gate` reported **success** while `integration` and `e2e (CLI, live registries)` were `failure`.
- On #416 (a docs PR), `CI Gate` concluded in **~1.7 min**, before the heavy `e2e` fixture suite had finished registering/draining.

Impact: a red `integration` / `e2e` could merge, because branch protection requires only `CI Gate` and `CI Gate` can go green without them. (It didn't bite during the epic only because every PR happened to merge with those green.)

---

## Evidence — measured on putitoutthere PR #418 (head `ee9006c`)

All **15 workflow runs were created simultaneously** at the push (`2026-06-16T00:31:17Z`), run-level `run_started_at == created_at` for every one. The latency is **not** at run creation; it's at the **job** level — when each run's jobs get a runner and register a check run.

| Check (job) | job `started_at` | start latency | duration |
|---|---|---|---|
| `eslint` (Lint) | 00:31:21 | +4s | 21s |
| `e2e (CLI, live registries)` | 00:31:20 | +3s | 14s |
| `integration` | 00:31:26 | +9s | 15s |
| **E2E fixture suite** (run `27585736318`) | first job +4s | — | **108 jobs draining over ~6 min; last finished 00:37:42 (+6m25s)** |
| `CI Gate` (pr-monitor step) | ran 00:31:21 → **00:37:49** | — | 6m28s, concluded **success** |

Two things to take from this:

1. **Nothing is slow to *start*.** `integration` / `e2e (CLI)` begin within 10s and finish within ~25s. The "1.7 min" from #416 is not a check being slow to start — it's the **108-job fixture suite taking ~6 min to drain**, and `CI Gate` bailing during that window.
2. **On #418 the race did *not* bite** — `CI Gate` correctly waited the full 6.5 min — because *something* was in progress continuously across those 6 minutes, so its loop never observed a lull. The bug is a **race**: it manifests only when the in-progress set momentarily empties before the next jobs register.

The E2E fixture suite is the aggravator: it is one workflow whose `e2e` matrix (14 fixtures) calls a reusable workflow that itself fans out to per-target/per-OS `build` jobs plus a `needs:`-gated `publish` job — **108 jobs** for that single run, throttled across the runner pool. That fan-out is where the lulls live. (`e2e-fixture.yml` also uses `concurrency: cancel-in-progress: false`, so rapid pushes queue, widening the window further.)

---

## Root cause (the design flaw)

`pr-monitor@v1`'s loop (paraphrased from its inline `github-script`):

```js
let checkRuns = await fetchCheckRuns();              // checks.listForRef(sha)
const relevant = checkRuns.filter(notExcluded);
if (relevant.length === 0) return;                   // docs-only: green
do {
  inProgress = relevant where status in {queued,in_progress,pending};
  failed     = relevant where conclusion === 'failure';
  if (inProgress.length) {                           // <-- re-fetch ONLY while something is in progress
    if (timeout) { setFailed; break; }
    await sleep(interval);
    checkRuns = await fetchCheckRuns();
  }
} while (inProgress.length);
if (failed.length) setFailed; else greenSuccess;
```

The loop **re-fetches only while at least one check is in progress**. The instant every *already-registered* non-excluded check is terminal, the loop exits and reports on whatever it last saw. The flawed assumption is:

> "Every check that *will* run has already registered (as `queued`/`in_progress`) by the time the in-progress set first empties."

That assumption is false in two structural ways:

1. **`needs:`-gated jobs have no check run until their dependency completes.** Between a `build` finishing and its `publish` registering, that fixture has *nothing in progress*. (newer `pr-monitor` `main` added `minimum-checks` (default `1`) — but `1` only guarantees "≥1 other check appeared," not "all did," so the race is unchanged at the default, and any *static* floor breaks dynamic CI — see below.)
2. **Throttled fan-out**: with 108 jobs and a finite runner pool, a batch completes before the next is dispatched, so the next batch has no check run yet.

Either produces an instant of "zero in progress" that is **not** "done." If the fast single-job checks are also done at that instant, `pr-monitor` exits green.

---

## Rejected fixes (don't reach for these — they were tried on #418 and withdrawn)

- **Raise `minimum-checks` to a floor (~the expected check count).** Rejected: `CI Gate` must support **dynamic CI** — the set of checks varies per PR (path-filtered workflows like `actionlint`/`link-check`; a docs-only PR may legitimately have very few checks). A static floor either hangs lean PRs to timeout (false red) or is too low to close the race (false green). The whole value of the aggregator is that branch protection names *one* check and it adapts to whatever ran.
- **Enumerate `integration` / `e2e` / … as required status checks in branch protection.** Rejected: that *is* the per-workflow enumeration the aggregator exists to eliminate, and it breaks the moment a new workflow is added. `CI Gate` stays the **sole** required check.

---

## Proposed fix — monitor workflow **runs**, not check runs

**Why runs and not checks:** a **check run** is one job/check, and it only appears in the API once GitHub *schedules* that job — so the check-run list fills in over the life of the build and is gappy in between. A **workflow run** is the top-level workflow invocation; GitHub creates **all** of them at push (proven above: all 15 at `00:31:17`), and a run is not `completed` until *every* job inside it — `needs:`-gated jobs and reusable-workflow children included — has finished. So:

- The workflow-run set is **complete within seconds of the push** → "no run is pending" genuinely means "done," with no transient lulls.
- It is **inherently dynamic** → a docs PR that triggers one workflow has exactly one run; `pr-monitor` waits for that one. No floor, no enumeration.
- Waiting for the `E2E` run to complete **subsumes all 108 of its child jobs**, so the fan-out can't slip through.

Sketch (replace the check-run polling with run polling):

```js
const headSha = context.payload.pull_request?.head?.sha ?? context.sha;

async function fetchRuns() {
  const { data } = await github.rest.actions.listWorkflowRunsForRepo({
    owner, repo, head_sha: headSha, per_page: 100,
  });
  // Exclude pr-monitor's OWN run (it's in_progress because we're in it).
  // Match by run id, not name — robust to workflow renames.
  return data.workflow_runs.filter(r => r.id !== context.runId);
}

const PENDING = new Set(['queued', 'in_progress', 'requested', 'waiting', 'pending']);
const FAILED  = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required']);
// success / skipped / neutral / stale => non-blocking

await sleep(PRE_SLEEP);                       // absorb the brief head_sha indexing lag
let runs = await fetchRuns();
while (runs.some(r => PENDING.has(r.status))) {
  if (timedOut) { core.setFailed('timeout'); break; }
  await sleep(CHECK_INTERVAL);
  runs = await fetchRuns();
}
const failed = runs.filter(r => FAILED.has(r.conclusion));
if (failed.length) core.setFailed(`Failed runs: ${failed.map(r => r.name)}`);
else core.info('All workflow runs completed successfully');
```

Notes for the implementer:
- **Self-exclusion by `context.runId`** is the important change from the current name-based exclusion; the `job-name` input is no longer needed for correctness (keep it for messaging if you like).
- Map run **conclusions** carefully: `skipped` / `neutral` must be treated as **non-blocking** (a workflow whose jobs are all `if:`-skipped concludes `skipped` and must not fail the gate, nor be waited on forever).
- Keep `pre-sleep` to cover the short window where `?head_sha=` isn't indexed yet (putitoutthere's `evidence-check.yml` documents the same lag). Consider a small "must observe ≥1 run before declaring green" guard so an indexing miss can't produce an instant false-green; at run granularity even most docs PRs have ≥1 run.

---

## Open questions / edge cases to decide in `pr-monitor`

1. **`workflow_run`-triggered runs** appear *after* their trigger completes, so they aren't in the initial run list and could register late — reintroducing a "how do I know the set is complete?" question, but for a far rarer topology. putitoutthere has **none** of these on PRs (verified: all 15 PR runs are `pull_request`-triggered and created at push). Decide whether to (a) accept this as a documented limitation, or (b) keep polling some bounded extra window. Don't let it block the main fix.
2. **`pre-sleep` semantics** — `main` already subtracts setup time from `pre-sleep`; keep that.
3. **Backwards compat** — this changes the model from "wait for sibling *jobs*" to "wait for sibling *runs*." Other consumers (e.g. dirsql) should be unaffected behaviorally (still "wait for everything else to finish"), but call it out in the changelog and consider a major version bump; putitoutthere pins `@v1` in `ci-gate.yml`.

---

## How to verify the fix

The witness on putitoutthere: a PR with a **deliberately failing** `integration` or `e2e (CLI)` test must drive `CI Gate` **red**. Today it can slip green. After the fix, with `ci-gate.yml` pointed at the fixed `pr-monitor`, that PR must fail `CI Gate`.

A tighter unit-level repro inside `pr-monitor`: simulate a SHA whose check-run stream has a gap (fast check terminal at t0; a `needs:`-gated check that only registers at t0+Δ) and assert the old code exits green at t0 while the runs-based code waits. The run-list fixture should contain the still-`in_progress` parent run across the whole window.

---

## Appendix — raw data (putitoutthere PR #418, head `ee9006c`, run set `27585736293…338`)

- 15 workflow runs, all `created_at == run_started_at == 2026-06-16T00:31:17Z`.
- `Lint`/`eslint` job: start 00:31:21 (+4s), end 00:31:42.
- `E2E (CLI)`/`e2e (CLI, live registries)` job: start 00:31:20 (+3s), end 00:31:34.
- `Integration`/`integration` job: start 00:31:26 (+9s), end 00:31:41.
- `E2E` run `27585736318`: `total_count = 108` jobs; earliest job start 00:31:21 (+4s); last job (`pypi-publish`) completed 00:37:42 (+6m25s).
- `CI Gate` run `27585736324`: `pr-monitor@v1` step ran 00:31:21 → 00:37:49 (6m28s), conclusion `success` (correct *this* time — no lull occurred).
- `pr-monitor@v1` `action.yml` inputs: `job-name`, `excluded-jobs`, `pre-sleep` (10), `check-interval` (5), `timeout` (10), `github-token`. (No `minimum-checks` on `v1`; `main` adds it, default `1`.)
