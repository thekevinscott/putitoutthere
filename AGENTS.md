# Guidance for LLM agents

This file is the primary instruction set for any LLM (Claude, Codex, Cursor,
etc.) working in this repo. `CLAUDE.md` exists as a Claude-specific entry
point that `@`-includes this file, so edit here — not there.

## Where to put what

- **`docs/`** — public-facing documentation. Rendered by VitePress and published to GitHub Pages. Anything here is read by users of `putitoutthere`. See [`docs/AGENTS.md`](docs/AGENTS.md) for authoring rules.
- **`notes/`** — working notes, audits, handoffs, and session artifacts. Not rendered, not public. Put session debriefs, post-mortems, handoff briefs, and scratch planning here.
  - `notes/audits/YYYY-MM-DD-<topic>.md` — post-hoc investigations and bug catalogues.
  - `notes/handoff/YYYY-MM-DD-<topic>.md` — handoff briefs for the next agent/session.
- **`migrations/`** — per-library migration plans for moving existing packages onto `putitoutthere`.

When in doubt: if it would confuse a first-time user reading the docs site, it belongs in `notes/`, not `docs/`.

## Design commitments

Explicit non-goals that bound `putitoutthere`'s scope. Read before proposing
features that expand the tool's surface area.

@notes/design-commitments.md

## Changelog and migration policy

Every PR that changes public API **must** update both `CHANGELOG.md` and
`MIGRATIONS.md` in the same PR. This is enforced in CI
(`.github/workflows/changelog-check.yml`). We are not yet strict about
semver, so the bar is deliberately wide: any observable change to consumer
surface — breaking or additive — needs an entry in both files.

"Public API" means anything a downstream consumer can observe:

- The reusable workflow's `workflow_call` inputs, outputs, and default
  behavior (`.github/workflows/release.yml`, when published).
- `putitoutthere.toml` schema — keys, value grammars, defaults, validation
  rules (`docs/guide/configuration.md`, `docs/guide/shapes/`).
- The `release:` trailer grammar (`docs/guide/trailer.md`).
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

Single file at the repo root, auto-included into the docs site at
`/guide/migrations` via VitePress's `<!--@include:-->` directive. New
entries go under `## Unreleased`. Each entry uses this structure:

1. **Summary** — one paragraph: what changed and why.
2. **Required changes** — before/after table covering config, reusable
   workflow inputs, and any consumer-side YAML they need to touch. "None"
   if the change is purely additive.
3. **Deprecations removed** — anything previously warned about that is now
   gone. "None" if nothing was removed.
4. **Behavior changes without code changes** — same API, different runtime
   behavior (tag format, exit codes, retry semantics, default values).
5. **Verification** — what the consumer can observe to confirm the upgrade
   worked (a tag push, a release on GitHub, output of `workflow_dispatch`
   with `dry_run: true`, etc.).

When a version is cut, the release process renames `## Unreleased` to
`## v<OLD> → v<NEW>` in both files and opens a fresh `## Unreleased` block.

Don't confuse `MIGRATIONS.md` (upgrade guide between `putitoutthere`
versions) with `migrations/` at the repo root (per-library plans for
*adopting* `putitoutthere` from hand-rolled tooling).
