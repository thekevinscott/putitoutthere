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

## Changelog policy

Every PR that changes public API **must** update `CHANGELOG.md` in the same
PR. "Public API" here means anything a downstream consumer can observe:

- CLI commands, subcommands, flags, arguments, exit codes, and stdout/JSON
  output shapes (`docs/api/cli.md`).
- GitHub Action inputs, outputs, and default behavior (`action.yml`,
  `docs/api/action.md`).
- `putitoutthere.toml` schema — keys, value grammars, defaults, validation
  rules (`docs/guide/configuration.md`, `docs/guide/shapes/`).
- The `release:` trailer grammar (`docs/guide/trailer.md`).
- Tag format, GitHub Release body shape, and any other artifact a consumer
  workflow might grep.
- TypeScript exports from `src/index.ts` (if/when we commit to them as a
  library surface — today they're internal).

Purely internal refactors, test-only changes, and docs-only edits do not
require a changelog entry.

Entries go under an `## Unreleased` heading grouped by `Added` / `Changed` /
`Deprecated` / `Removed` / `Fixed` (Keep a Changelog style). Breaking
changes get a `**BREAKING**` prefix and a one-line pointer to the migration
guide (see below) so consumers can find the upgrade steps without digging.

## Migration guides

Every breaking change to public API also gets a dedicated migration guide
at `docs/guide/migrations/v<OLD>-to-v<NEW>.md`, linked from the changelog
entry. These are for downstream consumers upgrading between `putitoutthere`
versions — not to be confused with `migrations/` at the repo root, which
holds plans for *adopting* `putitoutthere` from hand-rolled tooling.
