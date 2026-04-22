# Handoff: agent-behavior eval harness — red baseline reached

**Date:** 2026-04-22
**Branch:** `claude/evals-spike` (pushed to origin, head `32d02a7`)
**Tracking issue:** #164
**Status:** Red baseline committed. Ready for docs iteration.

## TL;DR

`evals/fixtures/dirsql-isolated` reproduces the failure mode that
motivated #164 — a single-turn probe that reads only piot's published
docs (no source, no web) and still makes confident false claims about
piot lacking features it ships. Current score: **3/6**, with
`npm_platform_family` as the canonical false negative (agent says piot
can't express per-platform npm packages; it can, via
`src/handlers/npm-platform.ts`).

Your job: iterate on `docs/` until the agent stops getting the
shipped-vs-missing call wrong on a primitive you touch, without
accidentally regressing another one.

## What happened in this session

1. **Four gap issues filed earlier in the session** (will be handled by
   another agent — don't re-file):
   - #169 — crates handler: `features` passthrough
   - #170 — `targetToOsCpu` silent fallthrough
   - #171 — PyPI `replacePyProjectVersion` vs. dynamic-version projects
   - #172 — reconcile `migrations/PLAN_GAPS.md` with
     `notes/design-commitments.md`; clarify publish-vs-build boundary
2. **Eval harness spike** at `evals/spike.sh` + fixtures. Went through
   three wrong turns before reaching the current shape — see
   "Gotchas" below so you don't repeat them.
3. **Confirmed reproduction** of the dirsql session's failure mode, with
   the user's explicit instruction that the red baseline must be
   committed *before* making any doc changes. It is (`32d02a7`).

## The eval, in one paragraph

`./evals/spike.sh dirsql-isolated` clones `thekevinscott/dirsql` into a
fresh `mktemp -d`, copies `docs/` from *this* repo into `$WORK/piot-docs/`,
writes a strict `.claude/settings.local.json` into `$WORK`, and runs
`claude -p` (Opus 4.7) with `HOME=$WORK` so the probe can only see (a)
the dirsql clone and (b) the piot docs snapshot. It then runs a Haiku
extractor that maps the probe's prose to six JSON primitive claims, and
a Python grader that diffs those against
`evals/fixtures/dirsql-isolated/expected.json`. Exit 0 on pass, 1 on any
mismatch. See `evals/README.md` for the full writeup.

## Current red baseline (run at 2026-04-22T16-23-27Z)

| Primitive                       | Truth   | Agent's claim | Pass | Notes                                                                    |
|---------------------------------|---------|---------------|------|--------------------------------------------------------------------------|
| `npm_platform_family`           | shipped | **missing**   | ✗    | **Critical false negative — same class as dirsql session.** First target. |
| `depends_on_serialization`      | shipped | shipped       | ✓    |                                                                          |
| `idempotent_precheck`           | shipped | shipped       | ✓    |                                                                          |
| `bundled_cli_understood`        | shipped | shipped       | ✓    | Close call — extractor accepted; re-run 2× before declaring stable.     |
| `per_target_runner_override`    | missing | not_mentioned | ✗    | Weaker fail (silence, not false claim). Secondary.                       |
| `doctor_oidc_trust_policy_check`| missing | not_mentioned | ✗    | Weaker fail. Secondary.                                                  |

Raw snapshot: `evals/snapshots/dirsql-isolated-2026-04-22T16-23-27Z-raw.md`.
Read the probe's own words before editing docs — the reasoning it
constructs tells you which doc page it *tried* to rely on.

## Your next step

**Attack the `npm_platform_family` false negative first.** The probe
reads `guide/concepts.md`, `guide/cascade.md`, `api/configuration.md`,
and `guide/auth.md` (per the raw output). It concludes "piot's build
modes are declarative metadata, not an executor" — it doesn't see that
`build = "napi"` or `build = "bundled-cli"` plus `targets = [...]`
actually *generates* the per-platform sub-packages and rewrites
`optionalDependencies`. The docs describe the *configuration surface*
but not the *behavior*.

Hypothesis worth testing with a doc change:

> Add a worked example to `docs/guide/npm-platform-family.md` (or
> similar) that shows: here is the config, here are the packages that
> get published, here is the top-level `package.json` that results. A
> before/after diff. Link from `concepts.md` and from the npm
> `kind = "npm"` section of `api/configuration.md`.

After editing:

```sh
./evals/spike.sh dirsql-isolated
```

Re-read the raw snapshot. If `npm_platform_family` flips to `shipped`,
confirm with two more runs (Haiku extractor is noisy on individual runs)
before calling it fixed. If another primitive regresses, the docs change
is load-bearing for that primitive too — don't ship the edit until net
score is better or equal *and* the false negative is gone.

## Gotchas I hit (don't repeat)

1. **VitePress served over localhost does not work.** Claude Code's
   `WebFetch` refuses `http://localhost` URLs as invalid (anti-SSRF).
   This is why the harness copies `docs/` into `$WORK/piot-docs/` as a
   filesystem snapshot rather than booting a dev server. The probe reads
   markdown via `Read`.
2. **The host's global `Stop` hook (`/root/.claude/settings.json`)
   poisons both the probe and the extractor.** The hook runs
   `stop-hook-git-check.sh`, which blocks on uncommitted changes in the
   cwd — `$WORK` is a git repo (dirsql clone) with uncommitted
   `piot-docs/` and `.claude/settings.local.json`, so the hook fires and
   the agent starts responding to git-status prompts instead of the
   eval. **Fix already in place:** `HOME=$WORK` on both claude calls.
   Don't remove.
3. **Path-scoped permissions via `--allowed-tools` aren't enough for
   WebFetch in non-interactive mode** — the tool is "allowed" but each
   URL still prompts, and the prompt fails with no TTY. The harness now
   uses `settings.local.json` in `$WORK/.claude/` for pre-approval. If
   you need to change the permission set, edit the heredoc inside
   `spike.sh`, not the CLI flags.
4. **The probe WILL escape to `/home/user/put-it-out-there/...` if you
   let it.** Read/Grep/Glob absolute paths don't respect `cwd`. The
   harness denies `/home/**`, `/root/**`, `/etc/**` explicitly. Keep
   those denies.
5. **Bash is denied entirely.** `cat /abs/path`, `git --git-dir=...`,
   and friends trivially escape any filesystem scope, and whitelisting
   by command prefix is whack-a-mole. The probe gets Read/Grep/Glob,
   which is enough to investigate the dirsql clone. The original
   dirsql session *did* have Bash, but it also didn't have piot on
   disk; removing Bash here preserves reproduction, not tightens it.
6. **The Haiku extractor is an LLM.** Individual runs are noisy;
   treat a single grade as a sample. Run 2–3× before drawing
   conclusions about a docs change.
7. **Don't commit `docs/.vitepress/cache/` or a modified
   `docs/pnpm-lock.yaml`.** They leaked in once from my vitepress
   probing; I reverted both before committing the baseline.

## Known limitations (do not fix as prerequisites)

- **Single-turn, not multi-turn.** The real dirsql session was 8 turns.
  Reproducing multi-turn context accumulation is future work; the
  single-turn reproduction already catches the failure mode.
- **Clone is a moving target.** `setup.sh` does `git clone --depth 1`
  against main. If dirsql's main shifts under you during a doc-change
  cycle, scores may move for reasons unrelated to your edit. If that
  bites, pin a SHA in `setup.sh`.
- **Six primitives is not a comprehensive grader.** It covers the ones
  the dirsql session got wrong; a docs change could improve one of the
  six while degrading something else the eval doesn't measure.

## Files to know

- `evals/spike.sh` — the whole harness. ~230 lines. Read it.
- `evals/fixtures/dirsql-isolated/prompt.md` — the probe prompt
  (uses `{{DOCS_PATH}}` placeholder, substituted at run time).
- `evals/fixtures/dirsql-isolated/expected.json` — ground truth
  for the 6 primitives with evidence cites into `src/`.
- `evals/fixtures/dirsql-isolated/setup.sh` — clones dirsql into
  `$WORK`. Presence of this file marks a fixture as "isolated" shape.
- `evals/fixtures/dirsql-isolated/docs_server` — marker file that
  opts a fixture into the docs-copy mechanism. Name is legacy;
  don't rename without updating `spike.sh`.
- `evals/README.md` — user-facing docs for the harness. Keep in sync
  when harness shape changes.
- `evals/snapshots/` — gitignored run outputs. Don't commit unless
  the snapshot is the reference baseline (one was, from the very first
  spike — added with `git add -f`).

## Design commitments — don't get pressured off them

`notes/design-commitments.md` lists 6 non-goals. The dirsql session
surfaced pressure to expand scope in several of these directions. If a
docs change would imply piot absorbs build-side cross-compile matrices,
tag orchestration, or cargo-dist's lane, re-read the commitments before
shipping it. Docs should accurately describe what piot *is*, not
pretend it's something the design says it won't be.

## Not-your-problem list (being handled by another agent)

- #169 (crates features), #170 (triple fallthrough), #171 (pypi
  dynamic-version), #172 (PLAN_GAPS reconciliation).
- #159, #162 per user (handled separately).

---

If you get stuck and aren't sure whether your doc change is actually
useful: re-read `evals/snapshots/dirsql-isolated-2026-04-22T16-23-27Z-raw.md`
and compare it to the latest post-change snapshot. The probe is very
specific about *why* it draws each conclusion; that reasoning is the
best signal for what doc content is landing and what isn't.
