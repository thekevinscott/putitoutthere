# Investigation: issue #461 — post-release hook/callback

Date: 2026-07-16
Issue: [#461](https://github.com/thekevinscott/putitoutthere/issues/461)
Motivating consumer: dirsql fragment-based changelog assembly
(thekevinscott/dirsql#561)

## The ask, restated

A consumer wants to run its own bookkeeping — dirsql's case is towncrier
changelog-fragment assembly — *when a release actually ships*, using the
facts of that release (which packages, which versions, which tags). The
issue deliberately states the need, not a design, and explicitly offers
to adapt dirsql's side (a `dirsql-checks` subcommand) to whatever shape
lands.

## Bottom line

The need is legitimate and the motivation is sound, but the word "hook"
points at the wrong mechanism. **putitoutthere should not run
consumer-supplied code inside its pipeline** — that is non-goal #4
("Build escape hatches … No pre-publish shell hooks … Generic hooks
metastasise into a plugin ecosystem"). A `post_release_run:` input, a
`[hooks]` config table, or any "we exec your script" shape is out of
scope and should be rejected.

What the issue actually needs is already the architecture's native idiom:
**emit the release outcome as reusable-workflow outputs, and let the
consumer compose a downstream job on them in their own caller workflow.**
putitoutthere supplies *the moment and the facts*; the consumer supplies
*the logic*, in their own repo context, on their own runner, with their
own permissions. That is "adapt to existing tools and workflows / compose,
don't absorb," not a hook.

This is the same shape consumers already paste today: the `pypi-publish`
job in every caller's `release.yml` runs `needs: release` /
`if: needs.release.outputs.has_pypi == 'true'` (README lines 38–40). The
issue is asking for one more output to gate one more downstream job on.

## Why this is composition, not a hook (non-goal #4)

Non-goal #4 forbids running arbitrary consumer code *inside* the
release pipeline — pre-publish shell hooks, `build_workflow:` delegation,
arbitrary `steps:`. The failure mode it guards against is putitoutthere
growing a plugin surface it must version and secure, and consumer logic
executing with the publish job's OIDC / `id-token: write` credentials.

Emitting outputs sidesteps all of that:

- putitoutthere executes **zero** consumer code. It writes structured
  data to `$GITHUB_OUTPUT`; the consumer's *own* job — a job that lives
  in the consumer's `release.yml`, that putitoutthere never sees —
  reads it.
- The consumer's job runs with whatever permissions the consumer grants
  it, not the publish job's. No credential bleed.
- There is nothing to version as a plugin contract beyond the output
  schema, which is data, exactly like `has_pypi` already is.

So the distinction is sharp: **a hook runs the consumer's code; an
output lets the consumer's workflow run its own code.** Only the first
is the non-goal.

## The current surface, and the gap

The reusable workflow (`release.yml`) declares exactly one output today:

- `has_pypi` — `'true'` when the *planned* matrix contains any pypi rows.
  Sourced from `_matrix.yml`'s `plan` job. It is a **plan-time**
  signal ("we intend to build pypi"), not a **publish-time** signal
  ("we shipped").

The publish job (`release.yml` → `jobs.publish`) runs the engine's
`publish` command and then `release-github`, but it has **no `outputs:`
block**, and the reusable workflow surfaces nothing from it. The engine
*does* know precisely what shipped — `publish` returns
`result.published: [{ package, version, result: { status } }]`
(`packages/engine/src/cli.ts`, the `publish` case ~line 537) — but that
data is written only to **stdout** (or `--json`). Unlike `plan`, the
`publish` case never writes to `$GITHUB_OUTPUT`. So the facts the issue
wants exist in memory at exactly the right moment and are then dropped on
the floor.

That is the whole gap. Three small pieces close it:

1. **Engine:** in the `publish` command, when `GITHUB_OUTPUT` is set,
   append a machine-readable summary of `result.published` (mirroring
   how `plan` already appends `matrix`). Suggested shape: a `released`
   boolean (did ≥1 package publish) and `released_packages` as a JSON
   array of `{ name, version, tag }`. The tag is what dirsql's changelog
   section title wants; it is already computed on the publish path
   (annotated tags are created there), so this is surfacing, not new
   logic — it stays within non-goal #7 ("no parallel reimplementation").
2. **`release.yml` publish job:** add an `outputs:` block wiring those
   step outputs up to the job.
3. **`release.yml` `workflow_call.outputs`:** declare `released` and
   `released_packages`, propagating from the publish job — the same
   two-hop wiring `has_pypi` already uses (`plan` step → job → workflow).

Then a consumer writes, in their own `release.yml`:

```yaml
  post-release:
    needs: release
    if: needs.release.outputs.released == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v7
      - run: |
          # consumer's own logic — e.g. dirsql-checks assemble-changelog
          # reads needs.release.outputs.released_packages for tags/versions
      - # commit the assembled CHANGELOG.md back to main
```

## Plan-time vs publish-time is the crux

`has_pypi` is plan-time and that is correct for its job (it lets a
non-pypi repo skip wiring the `pypi-publish` job at all). But #461's
signal **must be publish-time**: the consumer's premise is "only the
release pipeline knows a release *happened*," and "planned" ≠ "happened."
A plan can be non-empty and still publish nothing new (idempotent
re-run, every version already on the registry). Gating changelog
assembly on a plan-time signal would assemble on no-op runs. So the new
output has to reflect `result.published`, not the matrix. This is the
one design point that isn't just "copy has_pypi."

## Concerns the issue raises, and where each lands

- **"Output must land back in the caller's repo without re-triggering
  the pipeline in a loop."** Caller-side, and manageable — not something
  putitoutthere should absorb. Change detection is per-package glob; a
  consumer whose release globs are `src/**`, `Cargo.toml`, etc. can
  commit `CHANGELOG.md` / delete `changelog.d/*` without matching any
  package's globs, so the write-back push plans an empty matrix and
  publishes nothing. Worth a README recipe ("Post-release bookkeeping")
  spelling this out; not worth a mechanism.
- **"Failure should be recoverable / publish shouldn't be hostage to
  assembly."** Satisfied for free by the composition shape: the
  consumer's `post-release` job is a *separate* job that runs after
  publish already succeeded. If it fails, the packages are already
  shipped and the fragments are still in the tree for next time. No
  coupling to design.
- **"Not specific to dirsql or changelogs."** Correct, and the
  output-based shape is maximally generic without putitoutthere knowing
  anything about towncrier: docs version stamping, announcements, and
  fragment assembly are all "a downstream job gated on `released` reading
  `released_packages`."

## Fit against the design commitments

- **Non-goal #4 (build escape hatches):** respected — no consumer code
  runs in-pipeline.
- **Non-goal #6 (changelog generation):** respected — putitoutthere
  neither reads nor writes changelogs; it emits release facts and the
  consumer's own job does towncrier.
- **Non-goals #7/#8 (no parallel logic, no fragmented diagnostic
  surfaces):** respected — the new outputs are a thin surfacing of data
  the publish path already computes, exposed through the single reusable
  workflow, not a new subcommand or per-check input the consumer
  assembles by hand.
- **"No release surprises" / "compose with existing tools":** advanced —
  the consumer's changelog stops trailing shipped releases, using the
  Actions-native `needs`/`outputs`/`if` idiom they already use for
  `pypi-publish`.

## Recommendation

Accept the *need*; reject the *"hook"* framing. Implement as reusable-
workflow **outputs** (`released` + `released_packages`), sourced from the
engine `publish` command writing `result.published` to `$GITHUB_OUTPUT`,
with a README "Post-release bookkeeping" recipe covering the downstream
job and the don't-re-trigger write-back. This is consumer-observable
surface (new workflow outputs + documented behavior), so it lands under
the red/green TDD workflow with `CHANGELOG.md` / `MIGRATIONS.md` entries.
Suggested test tier: integration (drive `publish` through the SDK with
the subprocess boundary mocked, assert the `$GITHUB_OUTPUT` lines), plus
a workflow-contract check only if the two-hop output wiring turns out to
be reviewer-invisible.

### Open questions for the maintainer

1. Output naming: `released` / `released_packages`, or fold into a
   single JSON `release` object? (One object is fewer outputs to version;
   two scalars are easier to gate `if:` on.)
2. Should `released_packages` include publish `status` (e.g.
   `already-published` vs `newly-published`) so a consumer can
   distinguish a true first-ship from an idempotent re-run, or is
   "these tags now exist" enough?
3. Is a README recipe sufficient for the write-back-without-loop
   guidance, or is a dedicated `notes/internals/` contract wanted?
