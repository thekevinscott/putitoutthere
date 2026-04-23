# Handoff: agent-behavior eval — green

**Date:** 2026-04-23
**Branch:** `claude/evals-spike`
**Tracking:** #163, #164
**Status:** 6/6 × 5 runs. No false negatives, no silents. Ready to merge.

## What this measures

An external AI agent, reading only piot's published docs, tries to
evaluate piot against dirsql's release machinery. Six primitives are
graded: does the agent correctly conclude each is `shipped` or
`missing` per `evals/fixtures/dirsql-isolated/expected.json`?

## Final state

```
primitive                        | r1 | r2 | r3 | r4 | r5 | truth
-----------------------------------------------------------------
npm_platform_family              | ✓s | ✓s | ✓s | ✓s | ✓s | shipped
depends_on_serialization         | ✓s | ✓s | ✓s | ✓s | ✓s | shipped
idempotent_precheck              | ✓s | ✓s | ✓s | ✓s | ✓s | shipped
bundled_cli_understood           | ✓s | ✓s | ✓s | ✓s | ✓s | shipped
per_target_runner_override       | ✓m | ✓m | ✓m | ✓m | ✓m | missing
doctor_oidc_trust_policy_check   | ✓m | ✓m | ✓m | ✓m | ✓m | missing
```

All 5 runs graded 6/6. Reference snapshots at
`evals/snapshots/dirsql-isolated-2026-04-23T16-*`.

## Trajectory

| Stage | Scores | Failure mode |
|---|---|---|
| Red baseline (pre-docs) | [4, 4, 4] | false-negative on bundled_cli, silent on missing pair |
| Iter1 (gaps page, polyglot-rust handoff) | [6, 3, 4] | high variance, still silent |
| Iter4b (static server, Sonnet extractor) | [5, 5, 3] | no false-negatives, still silent on missing pair |
| Iter6 (cleanUrls fix, Opus extractor, budget↑) | [2, 5, 4, 5, 5] | one truncated run, silent on doctor 3/5 |
| **Iter7 (eval-driven doctor promotion)** | **[6, 6, 6, 6, 6]** | **none** |

## What flipped the last two primitives

iter6's access log showed `/guide/gaps` was visited 4/5 runs but
`doctor_oidc_trust_policy_check` was silent 3/5. The content lived
in gaps.md's Section 3 ("Documented behaviours that look like gaps")
— too deep and mis-framed as clarification rather than a real gap.

Three eval-driven edits (not from #163's wishlist — from the log
data):

1. **`/guide/gaps` — promote doctor's trust-policy to Section 1**
   ("Out of scope, permanent non-goals"). It IS a non-goal, so it
   belongs there. Previously it was in Section 3.
2. **`/getting-started` — add "Migrating? Read this first" block.**
   Names the caller-filename pin + doctor-doesn't-catch-it + the
   tag-per-package change. Getting started is visited 5/5.
3. **`/guide/auth` — add "What doctor won't catch" subsection.**
   Probe reads auth.md when OIDC seems relevant; surfacing the
   gotcha there puts it in context.

That was enough to flip both silent primitives to ✓m × 5.

## What worked for the four "shipped" primitives earlier

Cumulative across iter1-iter6:

- **`/guide/npm-platform-packages`** page — behavior (not just config)
  for napi + bundled-cli. Flipped `bundled_cli_understood` from
  flickering to rock-solid.
- **`/guide/handoffs/polyglot-rust`** — dirsql-shape worked example
  with a "what piot covers / what your workflow owns" table. Hit
  2/5 runs; when hit, reliably catches npm_platform_family,
  depends_on_serialization, idempotent_precheck.
- **Concepts.md "What piot covers / out of scope" section at the top.**
  Concepts is visited 3/5; when hit, the non-goal enumeration lands
  per_target_runner_override correctly.
- **Getting-started "Does piot fit?" checklist.** Up front,
  5/5 visits.

## Harness final shape

- `evals/spike.sh` — single-run harness. vitepress build + custom
  Node docs server (`evals/tools/docs-server.mjs`) with cleanUrls
  and access logs. Probe (Opus 4.7, $8 budget) runs inside
  `unshare --user --mount` with a tmpfs masking
  `/home/user/put-it-out-there` from the probe's view. Probe uses
  `agent-browser` + Chromium to navigate. Extractor is Opus with
  explicit per-primitive phrasing examples.
- `evals/run-n.sh` — sequential N-run driver. Prints per-run
  summary and a cross-run primitive-stability table. Aborts the
  loop on spike.sh exit 6 (rate-limit signal).
- `evals/fixtures/dirsql-isolated/{prompt.md,expected.json,setup.sh,docs_server}`.
- `evals/snapshots/` — gitignored; reference trios force-added per
  iteration (red baseline, intermediate, final green).

Full methodology for applying this pattern to another library:
`notes/docs-eval-methodology.md` (on separate branch
`claude/docs-eval-methodology`).

## What's left for another agent

- **#163's specific wishlist items we didn't need.** The eval made
  several of #163's suggestions redundant — handler-vs-builder
  callout, index.md hero refresh, separate builders.md, capabilities
  --json. None showed up as doc-quality issues in the eval's 5-run
  green. Worth reading the issue's rationale before declaring them
  dead; the eval may not be catching everything #163 is worried
  about. If you do pick them up, eval-first: decide what primitive
  they'd fix, check whether current eval catches that primitive,
  and only do the work if there's a measurable miss.
- **Extending the eval.** Six primitives is a minimum viable
  rubric. Adding more from the original dirsql session's other
  misreads would tighten coverage. See `expected.json` for the
  current set; add new primitive keys and update the extractor's
  prompt with per-primitive phrasings.
- **Multi-turn replay.** Current harness is single-turn; the real
  session was 8 turns. Multi-turn context accumulation is its own
  failure mode.
- **Other consumer shapes.** `dirsql-isolated` fixtures the
  polyglot-Rust shape. Add fixtures for other shapes (single-npm,
  monorepo of pure-JS packages, crates-only) so iteration on docs
  for one shape doesn't silently regress another.

## Files changed this session

Docs:
- `docs/guide/concepts.md` — scope section, pointer to /guide/gaps.
- `docs/guide/configuration.md` — build-side responsibilities callout.
- `docs/guide/auth.md` — "what doctor won't catch" subsection.
- `docs/guide/gaps.md` — new page; doctor in Section 1.
- `docs/guide/npm-platform-packages.md` — new page.
- `docs/guide/handoffs/polyglot-rust.md` — new page.
- `docs/getting-started.md` — "does piot fit" checklist + migration callout.
- `docs/.vitepress/config.ts` — sidebar entries for gaps,
  npm-platform-packages, handoffs.

Evals:
- `evals/spike.sh`, `evals/run-n.sh` — harness.
- `evals/tools/docs-server.mjs` — static server with cleanUrls + logs.
- `evals/fixtures/dirsql-isolated/*` — the fixture.
- `evals/README.md` — user-facing doc.
- Per-iteration snapshot trios in `evals/snapshots/` (force-added).

Notes:
- `notes/docs-eval-methodology.md` — reusable pattern (on its own
  branch `claude/docs-eval-methodology`).
- `notes/handoff/2026-04-22-eval-harness-red-baseline.md` (this file,
  continuing to track state).
- `notes/design-commitments.md` — existing; not modified.

## Not-this-agent's-problem

- #169–172 (code-side gaps) — another agent.
- Docs-eval skill packaging — another agent (user confirmed).
- #159, #162 per user — handled separately.
