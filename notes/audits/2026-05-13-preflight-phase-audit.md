# Preflight phase audit — 2026-05-13

Closes the "audit only" half of #318. Walks every existing check in
`src/preflight.ts`, `src/completeness.ts`, `src/cascade.ts`, and
`src/config.ts`, asks where it could *earliest* run, and notes the
delta against where it runs today.

The operative rule (from `notes/design-commitments.md` after #316,
"No release surprises"):

> Anything we can check against the consumer's repo alone, we check
> at PR time. Anything we can check from the planned matrix, we check
> at plan time. Only checks that depend on live registry state are
> allowed to wait until publish.

"PR time" here means a check that runs inside a CI job triggered by a
pull request, against the PR's worktree, with no registry creds and
no built artifacts. "Plan time" means a check that runs after
`putitoutthere plan` has produced the matrix (so it can see `kind`,
`target`, `version`, `artifact_name` per row) but before any build
step has produced an artifact. "Publish time" means the publish job,
where build artifacts are downloaded and registry creds (OIDC or
tokens) are populated in `process.env`.

## Triage table

| # | Check | What state it reads | Earliest knowable phase | Currently runs at | Move? |
|---|-------|---------------------|-------------------------|-------------------|-------|
| 1 | `preflight.checkAuth` | `process.env[ACTIONS_ID_TOKEN_REQUEST_TOKEN]` + per-kind `*_TOKEN` env vars | Publish (the env values are populated only in the publish job; the path each kind expects is plan-knowable, but the **values** are not) | Publish (`publish.ts:88`) | No — see "Notes" |
| 2 | `preflight.checkProvenanceMetadata` | `<pkg.path>/package.json` `repository` field on every npm package | **PR** — pure read against the consumer's worktree, no runtime state | Publish (`publish.ts:94`) | **Yes** → PR |
| 3 | `preflight.checkCratesMetadata` | `<pkg.path>/Cargo.toml` `[package].description` / `.license` / `.license-file` on every crates package | **PR** — pure read against the consumer's worktree | Publish (`publish.ts:101`) | **Yes** → PR |
| 4 | `completeness.checkCompleteness` | `artifacts/<artifact_name>/…` on disk; matrix shape (kind/target/version) from the planner | Publish (artifacts don't exist before the build job runs); shape contract is plan-knowable but presence is not | Publish (`publish.ts:108`) | No |
| 5 | `cascade.assertNoCycles` (cycle detection) | `packages[*].depends_on` graph from `putitoutthere.toml` | **PR** — config alone | Plan + Publish (called inside `computeCascade`, which `plan.ts:78` invokes; `publish.ts:70` re-runs `plan()`) | **Yes** → PR |
| 6 | `cascade.assertNoCycles` (dangling `depends_on` ref) | Same graph; checks each `depends_on` entry resolves to a declared package | **PR** — config alone | Plan + Publish (same call site) | **Yes** → PR |
| 7 | `config.parseConfig` (TOML parse + Zod schema, incl. `tag_format` placeholder rules, `bundle_cli` / `targets` refinements, `npm.build` template + unique-mode refinements) | `putitoutthere.toml` text alone | **PR** — config alone | Plan + Publish (called via `loadConfig` at `plan.ts:60` and `publish.ts:51`) | **Yes** → PR |
| 8 | `config.detectCommonMistakes` (typo hints: `[packages]` → `[package]`, `registry =` → `kind =`, `files =` → `globs =`, missing `[putitoutthere]`) | Raw TOML object pre-Zod | **PR** — config alone | Plan + Publish (inside `parseConfig`) | **Yes** → PR |
| 9 | `config.assertUniqueNames` | Parsed package list | **PR** — config alone | Plan + Publish (inside `parseConfig`) | **Yes** → PR |

## Notes per row

### 1 — `checkAuth` stays at publish

`checkAuth` reads `process.env`. The env values it cares about
(`ACTIONS_ID_TOKEN_REQUEST_TOKEN`, `CARGO_REGISTRY_TOKEN`,
`PYPI_API_TOKEN`, `NODE_AUTH_TOKEN` / `NPM_TOKEN`) are populated by
the publish job's `permissions:` + `env:` blocks. A PR-time job
running the engine against the consumer's worktree has none of them
set, so the check has nothing to read.

There's a *related* check — "does the consumer's reusable-workflow
caller wire the right `permissions:` / `env:` shape for the matrix's
kinds?" — that **is** PR-knowable, but it operates on the
consumer's `release.yml`, not on `process.env`, and would be a new
check rather than a move of this one. Flagging it here so we don't
lose it; not in scope for #318 / #319.

Per design-commitment #8 ("Parallel diagnostic surfaces"), any
PR-time validation we add must compose into the single PR-time
reusable workflow shell (#317), not a sidecar `doctor` action.

### 2, 3 — `checkProvenanceMetadata`, `checkCratesMetadata`

These are the obvious wins. Both are pure reads against the
consumer's worktree (`<pkg.path>/package.json`,
`<pkg.path>/Cargo.toml`). The current placement at publish — *after*
the build job has spun up runners, downloaded artifacts, and
negotiated OIDC — is exactly the "release surprise" shape the new
goal exists to prevent. The check itself is already shaped for
batch reporting (every failing package, one error), so the move is
mechanical: invoke `requireProvenanceMetadata` and
`requireCratesMetadata` from the PR-time workflow against the
plan's selected-package list (or, since both checks short-circuit
non-{npm,crates} packages internally, against the full configured
package list).

The `require*` variants currently throw with publish-job framing
("…before runner work, beats failing deep inside the npm CLI after
artifact upload + OIDC negotiation"). The error copy stays accurate
when moved to PR time — the failure mode it describes is exactly
what we're now preventing — but the surrounding workflow output
(red X on the PR, not on the post-merge release run) is what makes
it a goal-aligned check rather than a slightly-faster publish
abort.

### 4 — `checkCompleteness` stays at publish

The shape contract for a row (`.crate` for crates, `.whl` /
`.tar.gz` for pypi, `package.json` / `<bundle>` for npm) is
plan-knowable — the planner emits `artifact_name` and we know what
file each kind+target should produce. But the check verifies that
the file *exists on disk under `artifacts/<artifact_name>/`*, and
that artifact is produced by the build job. There is no PR-time or
plan-time observation of "did the build succeed and produce the
right file" — that's literally the publish job's job. Leave it.

A stricter reading of the rule would say "publish only for live
registry state" — which `checkCompleteness` is not. The rule's
intent is best understood as "publish-only for things you literally
cannot know earlier"; build-output presence falls in that bucket
alongside live-registry-state, because the engine has no earlier
phase that observes the build output. If we ever introduce a
post-build/pre-publish phase as a distinct workflow boundary,
completeness moves to it; today it is the de facto first thing
publish does and that's fine.

### 5, 6 — Cascade graph validation

`assertNoCycles` and dangling-`depends_on` detection both operate
on `Package[]` straight from the config. They run inside
`computeCascade`, which runs inside `plan()`, which runs at
plan-time and again inside `publish()`. Today a config with a
`depends_on` cycle would fail every plan run and every publish run
*after* it has loaded git state and computed diffs — wasteful but
not dangerous.

PR-time gives us the early catch. The recommended shape is to keep
the `assertNoCycles` call inside `computeCascade` as defence in
depth (cheap, deterministic, no downside to running it twice) and
*also* invoke it from the PR-time workflow against the parsed
config. The PR-time invocation is the user-facing surface; the
in-`computeCascade` invocation is an invariant.

### 7, 8, 9 — Config schema, typo hints, unique names

Same story as 5/6. `parseConfig` is a pure function of the TOML
text. Every diagnostic it can emit (schema rejection, the typo
hints in `detectCommonMistakes`, the duplicate-name assertion) is
PR-time knowable because nothing about it depends on git, the
filesystem outside `putitoutthere.toml`, the matrix, or the
registries.

Today the only path that exercises `parseConfig` is `loadConfig`,
which runs from `plan()` and `publish()`. Both are post-merge
phases in the current reusable workflow. PR-time exposure is just
"load the config in the PR-time workflow shell and let
`parseConfig` throw."

Importantly, this audit treats `parseConfig` as one check from the
issue's perspective even though Zod emits many distinct
diagnostics. The move is the same for all of them.

## Suggested follow-ups

Per #318's acceptance criteria, anything earlier-knowable than where
it runs today needs a follow-up issue or scope into #319.

Recommended bundling for #319 (PR-time check implementation), in
order of "release surprise the rule was written to prevent" → "cheap
correctness invariant":

1. **#319 scope (release-surprise-class)**: hoist `requireProvenanceMetadata`
   and `requireCratesMetadata` invocations into the PR-time
   workflow. These are the two checks whose current placement most
   directly violates "no release surprises" — both have shipped real
   `400 Bad Request` / npm CLI failures deep inside the publish job
   (see #280, #290). Keep the `require*` variants at publish too as
   defence in depth; the PR-time call is the user-facing surface.

2. **#319 scope (correctness invariant)**: invoke `loadConfig`
   (which runs `parseConfig` → `detectCommonMistakes` →
   `assertUniqueNames`) and `assertNoCycles` against the consumer's
   `putitoutthere.toml` from the PR-time workflow. These are cheap
   and already exercised at plan+publish, so the PR-time invocation
   is purely additive and would replace the "first observed at
   plan" surface with "first observed at PR".

3. **New issue (parallel to #319, out of #318's scope)**:
   wire-up validator for the consumer's `release.yml` —
   `permissions:` / `env:` / `secrets:` shape against the planned
   matrix's kinds. This is the close relative of `checkAuth` that
   *is* PR-knowable, and exists because `checkAuth` itself can't
   move. File it as a separate ticket since it requires a new
   check rather than relocating an existing one.

No items deferred to publish "intentionally despite being knowable
earlier" — every check listed above either moves cleanly to PR time
or has a structural reason for staying at publish that the rule's
intent accommodates (`checkAuth` reads runtime env;
`checkCompleteness` reads build output).
