# Guidance for Claude / LLM agents

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
