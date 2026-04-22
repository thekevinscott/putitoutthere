# Handoff: agent-behavior eval — red baseline (v2)

**Date:** 2026-04-22
**Branch:** `claude/evals-spike` (pushed)
**Tracking:** #164
**Status:** Red baseline reproduced with full fidelity. Ready for docs iteration.

## What this measures

An external agent, reading only piot's **published, rendered docs
site**, tries to evaluate piot against dirsql's release machinery.
Six primitives are graded: does the agent correctly conclude each one
is `shipped` or `missing` per the ground truth in
`evals/fixtures/dirsql-isolated/expected.json`?

The motivating session (external dirsql agent, 2026-04) got several
primitives wrong — specifically, claimed piot *lacked* features it
ships. This harness reproduces that class of mistake so we can tell
whether a docs change fixes it.

## Red baseline (3 runs, 2026-04-22)

Consistent **4/6** across three runs. Snapshots:
`evals/snapshots/dirsql-isolated-2026-04-22T19-{22-37Z,28-56Z,37-40Z}-*`.

| Primitive                       | Pattern across 3 runs                              |
|---------------------------------|-----------------------------------------------------|
| `npm_platform_family`           | ✓ shipped × 3                                       |
| `depends_on_serialization`      | ✓ shipped × 3                                       |
| `idempotent_precheck`           | ✓ shipped × 3                                       |
| `bundled_cli_understood`        | ✓ × 2, **FN "missing"** × 1                         |
| `per_target_runner_override`    | ✗ silent × 3 (truth: missing)                       |
| `doctor_oidc_trust_policy_check`| ✗ silent × 2, correctly-missing × 1                 |

Two distinct failure classes:

1. **Flickering false negative** on `bundled_cli_understood`. The
   docs describe `build = "bundled-cli"` as a config value but don't
   explain the *behavior* — what actually happens at publish time,
   what packages get emitted, what ends up on the registry. When the
   probe doesn't build that mental model, it hedges into "missing."
2. **Persistent silence** on `per_target_runner_override` and
   (less so) `doctor_oidc_trust_policy_check`. Truth for both is
   `missing` — these are real doc gaps rather than
   agent-misinterpreting-correct-docs. Either the docs need to
   actively acknowledge the gap, or piot needs to fill it.

## How the harness is built (short)

`./evals/spike.sh dirsql-isolated` does:

1. Boots `vitepress dev` against this repo's `docs/` on a free port.
2. Clones `thekevinscott/dirsql` into `$WORK`.
3. Drops `.claude/settings.local.json` into `$WORK` with scoped tool
   permissions matching the foreign agent's surface (Read/Grep/Glob,
   scoped Bash, no WebFetch/WebSearch).
4. Runs `claude -p` (Opus 4.7) **inside `unshare --user --mount`
   with a tmpfs mask on `/home/user/put-it-out-there`**, so piot's
   source tree on the host is invisible — even through `cat /abs/path`
   or `git --git-dir=…`.
5. The probe uses `agent-browser` (Vercel Labs CLI + local Chromium)
   to navigate the docs. `AGENT_BROWSER_EXECUTABLE_PATH` points at
   a pre-downloaded Chromium because `agent-browser install` can't
   reach Google's Chrome CDN from this environment.
6. Haiku extracts structured claims; Python grader diffs vs.
   `expected.json`.

Full prerequisites and gotchas: `evals/README.md`.

## Your job: iterate on docs until 6/6

Best order of attack:

### 1. `bundled_cli_understood` (flickering false-negative)

This is the highest-value fix: same failure class as the foreign
agent's miss, and the docs have the config but not the behavior. Add
a worked example to `docs/guide/` (or a dedicated page) that shows:

- Here is a `putitoutthere.toml` with `[[package]]` + `kind = "npm"`
  + `build = "bundled-cli"` + `targets = [...]`.
- Here are the packages that get published as a result
  (`@scope/pkg-<slug>` per target).
- Here is the top-level `package.json`'s `optionalDependencies`
  after piot's rewrite.
- Link from `guide/concepts.md` and from the `kind = "npm"` section
  of `api/configuration.md`.

Re-run; confirm 3/3 correct.

### 2. `per_target_runner_override` (persistent silence)

Truth is `missing` — piot doesn't support per-target runner overrides.
The agent is silent because the docs don't mention runner selection
at all. Two paths:

- If this stays a non-goal (check `notes/design-commitments.md`),
  add a line to `guide/configuration.md` or wherever the matrix
  discussion lives: "piot does not expose per-target runner
  configuration; the generated workflow uses `ubuntu-latest` for all
  build jobs. Consumers who need ARM64 or macOS-specific runners
  should…" — explicit non-support is what makes the agent able to
  correctly call this missing.
- If it's something that *should* ship (cross-reference #170 on
  target triples), docs need to describe the expected config shape
  and the agent will pick it up.

### 3. `doctor_oidc_trust_policy_check` (mostly silent)

Truth is `missing`. Same pattern: `guide/auth.md` and `api/cli.md`
describe `doctor` but don't say what it validates — and specifically
don't say it doesn't validate the trust policy's workflow-filename
pin. A one-paragraph "what doctor checks / what it doesn't check"
section lets the agent conclude this correctly.

### 4. Don't regress the three that are green

`npm_platform_family`, `depends_on_serialization`, `idempotent_precheck`
all pass consistently. After each docs edit, confirm they still do.

## Loop mechanics

```sh
# Edit docs
$EDITOR docs/guide/bundled-cli.md

# Re-run (picks up edits via vitepress hot reload — same run)
./evals/spike.sh dirsql-isolated

# Read the probe's reasoning, not just the score
less evals/snapshots/dirsql-isolated-<ts>-raw.md

# Diff against baseline to see what changed
diff <(jq -S .results evals/snapshots/dirsql-isolated-2026-04-22T19-22-37Z-grade.json) \
     <(jq -S .results evals/snapshots/dirsql-isolated-<new-ts>-grade.json)
```

Run 3× per docs change before declaring a primitive fixed — extractor
noise is real (run 3 flipped one primitive that runs 1 & 2 got right).

## Don't confuse this with the docs-site deploy

The probe navigates a **local** vitepress dev server — not
thekevinscott.github.io. That's because `web_fetch` can't reach
localhost and the deployed docs URL isn't in this sandbox's egress
allow-list. The content is the same (edits to `docs/*.md` land in
the dev server's hot-reload); only the navigation is local.

## Previously filed issues (not your job)

- #169 — crates handler `features` passthrough
- #170 — `targetToOsCpu` silent fallthrough
- #171 — PyPI dynamic-version handling
- #172 — reconcile `PLAN_GAPS.md` with `notes/design-commitments.md`

Another agent is handling these. The eval harness doesn't depend on
them landing.

## Design commitments — don't get pressured

If a docs change would imply piot absorbs something `notes/design-commitments.md`
lists as a non-goal (version computation, tag orchestration, GH
Release archives, shell hooks, monorepo discovery, changelog), **don't**
make the change — add an explicit non-support callout instead.

## Files worth knowing

- `evals/spike.sh` — harness. ~260 lines.
- `evals/README.md` — user-facing doc.
- `evals/fixtures/dirsql-isolated/{prompt.md,expected.json,setup.sh,docs_server}`.
- `evals/snapshots/dirsql-isolated-2026-04-22T19-*` — the red-baseline
  trio (force-added; all other snapshots are gitignored).
