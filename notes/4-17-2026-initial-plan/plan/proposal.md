# Proposal: Put It Out There

Concise summary of the v0 design. Major decisions only; implementation
detail lives in `plan.md`.

---

## What it is

A GitHub Action + npm-published CLI (`pilot`) that turns `git push` to
`main` into a coordinated release across crates.io, PyPI, and npm. One
monorepo, one `pilot.toml`, one flow.

## Shape

- **One npm package:** `pilot`. Contains the CLI, the GHA wrapper,
  and three internal registry handlers (crates, pypi, npm). Not pluggable.
- **One GHA action:** `thekevinscott/put-it-out-there@v0`. Thin JS
  wrapper (~100ms cold start) that invokes the same code the CLI runs.

## Core model

1. User writes `pilot.toml` declaring packages, glob patterns, and
   optional `depends_on` edges.
2. Merge to `main` → pilot reads the merge commit → computes cascade
   from paths ∪ `depends_on` → builds → publishes → tags.
3. Default bump is **patch**. Optional `release:` git trailer overrides
   to `minor` / `major` / `skip`.
4. Manual trigger (`workflow_dispatch`) takes explicit bump + package
   list; overrides both cascade and trailer.

## Locked design decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Path filter is the primary release signal; trailer is an optional override | Matches merge-to-main = ship, no ceremony needed for 90% case |
| 2 | `depends_on` expresses transitive cascade, not duplicated globs | DRY; scales past 2 packages |
| 3 | Every merge touching relevant paths produces a patch release | Matches high-cadence LLM-authored workflow |
| 4 | `release:` trailer with `[pkg]` list is additive (Rule B): listed packages get the bump, unlisted cascaded packages still get patch | Covers both scoped bump and force-include with one mechanism |
| 5 | Three registry handlers live in-repo as internal modules; no plugin system | Speculative flexibility costs too much; PR upstream to add a registry |
| 6 | No-push tag model: manifest edits are CI-worktree-only; tag points at the merge commit | Kills the push race; `main`'s manifest stays stale by design |
| 7 | OIDC trusted publishing preferred; token fallback supported | Hybrid forever — crates.io still has no OIDC |
| 8 | No `pilot rollback` primitive; use `cargo yank` / `npm deprecate` + `git revert` | Republishing old code under new version misleads `>=` pinned consumers |
| 9 | TOML config (`pilot.toml`) at repo root | Familiar (Cargo.toml, pyproject.toml); nested arrays work cleanly |
| 10 | `pilot init` scaffolds `pilot/AGENTS.md` and appends `@pilot/AGENTS.md` to CLAUDE.md | Teaches the LLM agent the trailer convention |

## In scope for v0

- `pilot.toml` parsing, Zod schema validation
- Cascade algorithm (paths + `depends_on`, two-pass fixed-point, cycle detection)
- Trailer parsing (`release: <bump> [packages]`)
- Three handlers: crates, pypi, npm
  - Idempotency check per registry
  - Retry on transient (5xx / network) up to 3x with backoff
  - OIDC + token auth
  - Manifest edits in CI worktree (no push to main)
- Tag creation at merge commit; GitHub Release auto-created per tag
- Dry-run as PR check (catches config errors before merge)
- `pilot init`, `pilot plan`, `pilot publish`, `pilot doctor`
- CLAUDE.md / AGENTS.md scaffolding
- Structured logs (JSON in CI, plain in TTY)

## Explicitly out of v0 (on roadmap)

- Post-release smoke-test verifier (Docker install + user snippet)
- `pilot status` dashboard
- `pilot changelog` generator
- Rollback primitive (deliberately rejected, not deferred)
- Pre-release dist-tags (`-rc`, `-beta`, `-alpha`)
- Private registries
- Hotfix branches
- Scheduled / batched releases
- Non-Claude agent variants for `pilot init`

## Shape of config

```toml
[pilot]
version         = 1
default_branch  = "main"
tag_format      = "{package}-v{version}"
require_trailer = false

[[package]]
name          = "dirsql-rust"
kind          = "crates"
path          = "packages/rust"
paths         = ["packages/rust/**/*.rs", "packages/rust/Cargo.toml"]
first_version = "0.1.0"
auth          = "token"
token_env     = "CARGO_REGISTRY_TOKEN"

[[package]]
name          = "dirsql-python"
kind          = "pypi"
path          = "packages/python"
pypi          = "dirsql"
paths         = ["packages/python/**"]
depends_on    = ["dirsql-rust"]
build         = "maturin"
auth          = "oidc"
first_version = "0.1.0"
```

## Shape of workflow

User writes `.github/workflows/release.yml` with three jobs:

1. **plan** — `pilot plan` computes the release matrix.
2. **build** — user-authored matrix; their build tools produce artifacts.
3. **publish** — `pilot publish` picks up artifacts, publishes, tags.

Pilot owns plan + publish. User owns build (matrix, caching,
cross-compile). That split means pilot doesn't need to know how to build
every possible project.

## Success criteria for v0

1. The `dirsql` monorepo releases cleanly via pilot, replacing its ad-hoc
   script.
2. The `examples/rust-python-ts/` reference repo publishes to all three
   registries on a real cadence (polyglot validation — pilot itself is
   npm-only).
3. Full publish cycle runs in under 5 minutes on the reference repo.
4. Adding a new registry handler takes under a day for someone familiar
   with the target registry.
5. README walkthrough is reproducible by a new user in under 30 minutes.

## Testing

Non-negotiable. Three layers:
- Unit (vitest): pure functions — trailer parser, cascade, version bumper,
  tag resolver, glob matcher, retry policy. ~100% coverage.
- Handler: mocked registries — verdaccio (npm), pypiserver (PyPI),
  msw-stubbed HTTP (crates.io).
- End-to-end: full publish cycles via the CLI against mocked registries.

Optional weekly real-registry canary using a dedicated `pilot-canary`
package to catch registry API drift.

## Open decisions for review

None that block v0. `plan.md` enumerates ~6 open questions but all are
safe-to-defer.
