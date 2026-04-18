# Put It Out There — Plan

> Exhaustive implementation plan. For the concise yay/nay summary see
> `proposal.md`. For the canonical scope statement see `../INSTRUCTIONS.md`
> (takes precedence over this document on any conflict).

> **Status:** v0 design doc. Locked decisions below are locked for v0; the
> roadmap sections call out what is deliberately deferred.
>
> **Repo:** https://github.com/thekevinscott/put-it-out-there
> **CLI:** `pilot`
> **npm package:** `pilot`
> **Date:** 2026-04-17

---

## Table of Contents

1. [Overview](#1-overview)
2. [First-Principles Rationale](#2-first-principles-rationale)
3. [Non-Goals](#3-non-goals)
4. [Glossary](#4-glossary)
5. [System Architecture](#5-system-architecture)
6. [Config Schema (`pilot.toml`)](#6-config-schema-pilottoml)
7. [Registry Handlers](#7-registry-handlers)
8. [Adding a New Registry](#8-adding-a-new-registry)
9. [Workflow Shape](#9-workflow-shape)
10. [Release Trailer Convention](#10-release-trailer-convention)
11. [Cascade Algorithm](#11-cascade-algorithm)
12. [Build Step (User-Owned Matrix)](#12-build-step-user-owned-matrix)
13. [Publishing & Idempotency](#13-publishing--idempotency)
14. [Versioning & Tags](#14-versioning--tags)
15. [GitHub Releases](#15-github-releases)
16. [Credentials (OIDC + Tokens)](#16-credentials-oidc--tokens)
17. [CLAUDE.md / AGENTS.md Integration](#17-claudemd--agentsmd-integration)
18. [Dry-Run as PR Check](#18-dry-run-as-pr-check)
19. [When a Release Goes Bad](#19-when-a-release-goes-bad)
20. [Post-Release Verifier](#20-post-release-verifier)
21. [Command Surface (`pilot` CLI)](#21-command-surface-pilot-cli)
22. [State & Logs](#22-state--logs)
23. [Testing Strategy](#23-testing-strategy)
24. [Distribution](#24-distribution)
25. [v0 MVP Scope](#25-v0-mvp-scope)
26. [v0.1+ Roadmap](#26-v01-roadmap)
27. [Worked Example](#27-worked-example)
28. [Open Questions](#28-open-questions)
29. [Risks & Mitigations](#29-risks--mitigations)
30. [Appendix A: Why Not X?](#appendix-a-why-not-x)

---

## 1. Overview

**Put It Out There** (`pilot`) is a polyglot release orchestrator for
single-maintainer, LLM-authored projects that publish to multiple package
registries (crates.io, PyPI, npm) from a single monorepo.

The tool exists because the existing release tooling ecosystem (release-please,
changesets, Knope, semantic-release, Cranko) was designed for conventions that
don't hold when Claude is writing 90% of the commits:

- Conventional commit messages are noisy, forgotten, or inconsistently applied
  by LLM agents unless scaffolded explicitly.
- Changesets assume a human pauses to author a `.md` file per change.
- Release-PR models (release-please) add PR-review friction that makes sense
  for a team but is pure tax for a solo maintainer merging their own work.
- Cranko is the closest match but requires the `rc:` branch convention and
  does not cover PyPI or npm first-class.

Pilot's thesis: the release signal should be **path filters plus an optional
git trailer on the merge commit**; the cascade should be determined by
**`depends_on` edges between packages**; and the publishing step should
handle the ugly parts uniformly (OIDC auth, idempotency, retries,
version-file edits) across crates.io, PyPI, and npm.

### Shape of the solution

```
┌────────────────────────────────────────────────────────┐
│ GitHub Actions workflow (user-authored release.yml)    │
│  └─ uses: thekevinscott/put-it-out-there@v0            │
│       │                                                 │
│       ▼ (thin TS wrapper; ~100ms cold start)           │
│     pilot (single TS package)                           │
│       ├─ reads pilot.toml                               │
│       ├─ computes cascade (paths + depends_on)          │
│       └─ dispatches by package.kind:                    │
│             ├─ crates → crates.io                       │
│             ├─ pypi   → PyPI                            │
│             └─ npm    → npm                             │
└────────────────────────────────────────────────────────┘
```

---

## 2. First-Principles Rationale

### 2.1 Audience: LLM-authored, solo-maintained projects

The design target is a developer who works with Claude Code (or similar) as
the primary author, merges to `main` frequently, and wants releases to be
mechanical. That framing produces different defaults than a multi-committer
OSS project:

| Assumption                       | Traditional tool            | Pilot                                  |
|----------------------------------|-----------------------------|----------------------------------------|
| Who writes commits?              | Humans                      | LLMs + human merges                    |
| Cadence                          | Weekly–monthly              | Multiple times/day                     |
| Commit message reliability       | Self-enforced by discipline | Enforced by agent instructions         |
| Release review step              | Peer review + release PR    | Merge-to-main = intent to ship         |
| Cross-registry coordination      | Separate tools per ecosystem| Single cascade via path filters        |

### 2.2 Release signal: path filter primary, trailer as override

Pilot's primary release signal is the **path-filter cascade**: any merge to
`main` that touches a file matching a package's `paths` globs auto-releases
that package at **patch**. This matches the "merge-to-main = intent to ship"
philosophy for LLM-authored, high-cadence repos.

The **`release:` trailer is an optional override**, not a required signal:

- `release: minor` or `release: major` — bump beyond the default patch.
- `release: skip` — suppress release for this commit (docs-only PRs that
  happen to touch code paths).
- Omit the trailer — default to patch.

Why keep the trailer at all, if path filters carry the load?

- **Bump type has to come from somewhere.** PR labels are GitHub-only,
  editable after merge, and fragile. Commit-message prefixes (conventional
  commits) are noisier than a single trailer. A trailer is the lightest
  way to convey "this was a breaking change" without conventions that rot.
- **Machine-writable.** `git log --format=%B -1 $COMMIT` yields it cleanly;
  Claude can be instructed to append it deterministically when needed.
- **GitHub-preserved.** Squash-merge concatenates commit bodies; the
  trailer survives on the merge commit.
- **Skip is a real need.** A PR fixing a typo in code that lives inside a
  `paths` glob shouldn't ship a patch. `release: skip` solves that without
  new UI.

Changelog generation is orthogonal: it reads PR titles and descriptions for
the commits since the last release tag — the trailer doesn't need to
duplicate that.

### 2.3 Why path filters plus `depends_on`

Cross-language dependencies (a Python package wrapping a Rust crate via
PyO3, for instance) can't be expressed in Cargo.toml or pyproject.toml.
The user has to tell pilot about the relationship somehow.

Each package declares the globs that directly trigger its release (`paths`)
plus an optional `depends_on` list naming other packages. The cascade
algorithm (§11.1) unions direct path matches with transitive dep matches.

This keeps the common case trivial — independent packages just declare
their `paths` and omit `depends_on` — while the dep-graph case stays
explicit and DRY. The Rust path lives in one place (`dirsql-rust.paths`);
`dirsql-python` says `depends_on = ["dirsql-rust"]`.

Pilot does not try to infer the graph from Cargo.toml path-deps or
maturin config. Cross-ecosystem edges aren't declarable anywhere in the
source-of-truth manifests, so inference would break silently where it
matters most.

### 2.4 Why internal dispatch (not plugins)

Each registry has its own sharp edges:

- **crates.io:** yank-but-never-delete; version-immutable; requires Cargo.toml edit + `cargo publish`.
- **PyPI:** same permanence; OIDC trusted publishing via `pypa/gh-action-pypi-publish`; wheels per-platform via maturin/cibuildwheel.
- **npm:** 72-hour unpublish window; OIDC provenance; `package.json` version bump; supports pre-release dist-tags.

The natural shape for accommodating these is per-registry handlers behind
a common interface. We considered making those handlers external plugins
(separate npm packages, versioned API, discovery/loading machinery). For
v0 we're not doing that: the handlers live in `src/handlers/` as internal
modules, dispatched by a switch on `package.kind`.

Why: three registries, likely zero third-party extensions for the
foreseeable future. A plugin system costs peer-dep management, version
compatibility checks, discovery logic, a testkit, and a public API
contract — all paid up front for speculative flexibility. Collapsing to
internal dispatch saves ~50 lines of infra code per handler and keeps
everything one-version, one-release, one-test-suite. If pilot ever sees
real demand for external registries, factoring a handler out is a
refactor, not a redesign.

---

## 3. Non-Goals

Explicit list of things pilot does **not** try to do:

- **Changelog generation from commit prose.** The trailer says what version
  to ship; if you want a changelog, use `git log v1.2.2..v1.2.3 --oneline`.
  A `pilot changelog` command may arrive in v0.2+ but it is not in v0.
- **Multi-repo orchestration.** One repo, one `pilot.toml`.
- **Release PRs.** No intermediate PR between "merge to main" and "publish."
  Every merge to main with a valid trailer ships.
- **Dependency-graph inference across ecosystems.** The user declares path
  filters; pilot does not walk Cargo.toml, pyproject.toml, and package.json
  to infer them.
- **Private registries.** Not v0. Token-based auth may be extensible to
  private registries later but the OIDC code paths are public-registry-only.
- **Non-main release branches.** Everything ships from `main`. Hotfix branches
  are out of scope for v0.
- **Batched / nightly / scheduled releases.** Every merge to `main` that
  cascades releases immediately. No "batch up the day's merges and ship at
  5pm" mode. A scheduled runner may arrive in v2 if there's demand; v0 is
  immediate-only.
- **A replaceable planner / external policy layer.** Pilot has one flow:
  read `pilot.toml`, read git, cascade, publish. Consumer freedom lives in
  config. If a user wants fundamentally different release logic, they
  don't use pilot for that step — that's a feature, not a bug.
- **A plugin system.** See §2.4. Handlers are internal modules, not
  pluggable packages. Adding a new registry means a PR to this repo
  (§8), not a separate package.
- **Monorepo tooling it doesn't own.** Nx, Turborepo, Pants, Bazel integration
  is out of scope. Pilot reads `pilot.toml` and does the release; the user's
  build system does the build.

---

## 4. Glossary

| Term              | Meaning                                                                                       |
|-------------------|-----------------------------------------------------------------------------------------------|
| **Package**       | One row in `[[package]]` — a publishable unit (one crate, one wheel-set, one npm package).    |
| **Handler**       | Internal module for a single registry kind (crates, pypi, npm). Not pluggable.                 |
| **Release trailer** | A `release: patch|minor|major` line in the merge commit message body.                         |
| **Cascade**       | Packages that release on a given commit, computed from `paths` + `depends_on` (§11).           |
| **Idempotency check** | Handler-side check: "is this version already published?" If yes, skip cleanly.            |
| **Dry-run**       | `pilot plan --dry-run`: resolves versions and prints the publish graph without side effects.   |
| **Smoke test**    | Post-release check: install the published artifact in a clean env, run a user-defined snippet. |

---

## 5. System Architecture

### 5.1 Components

```
put-it-out-there/                         ← this repo, one npm package
├── action.yml                            ← GitHub Action entry (type: node20)
├── src/
│   ├── action.ts                         ← thin GHA wrapper; invokes run()
│   ├── cli.ts                            ← yargs/commander CLI entry
│   ├── run.ts                            ← top-level orchestration
│   ├── config.ts                         ← pilot.toml loader + schema
│   ├── cascade.ts                        ← paths + depends_on → package set
│   ├── trailer.ts                        ← parse `release:` from merge commit
│   ├── version.ts                        ← bump logic, tag formatting
│   ├── git.ts                            ← git wrapper (tag, log, trailer)
│   ├── handlers/                         ← internal per-registry modules
│   │   ├── index.ts                      ← dispatch by `kind`
│   │   ├── crates.ts
│   │   ├── pypi.ts
│   │   └── npm.ts
│   └── types.ts                          ← Handler interface (internal)
└── dist/                                 ← ncc-bundled action.js
```

One package, one version, one release. The `pilot` CLI and the GHA action
are two entry points into the same code.

### 5.2 Runtime shape

The GHA action is a **native JS action** (not a composite shell action, not a
Docker action). Rationale:

| Action type    | Cold start       | Notes                                      |
|----------------|------------------|--------------------------------------------|
| Docker         | 30–60s           | Slow; registry auth inside container       |
| Composite shell| 1–3s             | Hard to pass structured data between steps |
| Node (JS)      | ~100ms           | Fast, direct TS → JS entry point           |

At runtime:

1. GHA invokes `dist/action.js` (bundled via `@vercel/ncc`).
2. Wrapper parses action inputs (command, optional overrides) and invokes
   `run(command, cwd)` in-process.
3. `run` loads `pilot.toml`, computes the cascade, dispatches each package
   to its handler by `kind`.

For local use, the `pilot` CLI (`npm i -g pilot` or
`npx pilot`) calls the same `run` function. `pilot plan` in CI and
locally produce the same output.

### 5.3 Why the action wrapper is thin

The wrapper is intentionally about 50 lines: read `INPUT_COMMAND`, set env
for auth tokens, call `run(command, cwd)`, surface exit code. All business
logic lives in the library code so unit tests don't need GHA mocks, and
the same code is reachable from the CLI.

---

## 6. Config Schema (`pilot.toml`)

TOML chosen for ergonomic nested arrays and existing familiarity (Cargo.toml,
pyproject.toml). The file lives at the repo root.

### 6.1 Top-level

```toml
[pilot]
version      = 1                             # schema version (required)
agents_path  = "pilot/AGENTS.md"             # where `pilot init` writes the trailer doc
```

Fixed conventions (not configurable):

- Release branch is always `main`.
- Tag format is always `{package}-v{version}` (e.g., `dirsql-python-v0.3.5`).
- Trailer is optional; missing trailer = patch on cascade. No enforcement
  mode.

### 6.2 `[[package]]` entries

Each publishable unit gets one entry. Field reference:

```toml
[[package]]
name    = "dirsql-python"                    # unique pilot-internal name
kind    = "pypi"                             # handler key: crates | pypi | npm
path    = "packages/python"                  # working dir for build/publish
paths   = [                                  # cascade triggers (globs)
  "packages/python/**/*.py",
  "packages/python/pyproject.toml",
]
depends_on = ["dirsql-rust"]                 # transitive cascade: if
                                             # dirsql-rust releases, so do I

# Registry-specific:
pypi    = "dirsql"                           # name on PyPI (may differ from name)
build   = "maturin"                          # build recipe (handler-interpreted)
smoke   = "python -c 'import dirsql; dirsql.DirSQL'"

# Versioning:
first_version = "0.1.0"                      # initial version if no tag exists
```

**No auth fields in `pilot.toml`.** Secrets and env var wiring live in
the repository settings and the workflow YAML, never in committed config.
See §16.

### 6.3 Field reference (all packages)

| Field            | Required | Type         | Default           | Notes                                            |
|------------------|----------|--------------|-------------------|--------------------------------------------------|
| `name`           | yes      | string       | —                 | Unique within the repo                           |
| `kind`           | yes      | string       | —                 | `crates` \| `pypi` \| `npm` (extensible)          |
| `path`           | yes      | string       | —                 | Working directory; relative to repo root         |
| `paths`          | yes      | [string]     | —                 | Glob patterns for cascade                        |
| `depends_on`     | no       | [string]     | `[]`              | Other package names; transitive cascade          |
| `first_version`  | no       | string       | `0.1.0`           | Semver                                           |
| `smoke`          | no       | string       | —                 | Shell command run post-publish in clean env      |

No `tag_format` override — tags are always `{name}-v{version}`.
No `auth` / `token_env` — secrets are wired in the workflow YAML (§16).

### 6.4 Registry-specific fields

Each handler declares its own schema for fields outside the core reference.
All schemas live in-repo (`src/handlers/*.ts`) and are validated with Zod.

- **crates**: `crate` (crates.io name if differs from `name`), `features`,
  `target` (publishing target triple list).
- **pypi**: `pypi` (PyPI name), `build` (`maturin` \| `setuptools` \| `hatch`),
  `wheels_artifact` (artifact name to download from build matrix).
- **npm**: `npm` (npm name), `access` (`public` \| `restricted`), `tag`
  (dist-tag, default `latest`).

---

## 7. Registry Handlers

Three built-in handlers cover crates.io, PyPI, and npm. They live in
`src/handlers/` as internal modules, dispatched by a switch on
`package.kind`. They are not plugins — no external loading, no peer deps,
no separately-published packages.

### 7.1 Handler contract (internal)

```ts
// src/types.ts
export interface Handler {
  kind: 'crates' | 'pypi' | 'npm';

  /** Zod schema for registry-specific fields. */
  schema: ZodType<PackageConfig>;

  /** Registry query: is this version already published? No write auth. */
  isPublished(pkg: PackageConfig, version: string, ctx: Ctx): Promise<boolean>;

  /** Update manifest file(s) in the CI worktree. Returns modified paths. */
  writeVersion(pkg: PackageConfig, version: string, ctx: Ctx): Promise<string[]>;

  /** Publish. Throws on hard failure; returns cleanly if already-published. */
  publish(pkg: PackageConfig, version: string, ctx: Ctx): Promise<PublishResult>;

  /** Optional: docker-based install + user smoke command. */
  smokeTest?(pkg: PackageConfig, version: string, ctx: Ctx): Promise<SmokeResult>;
}

export interface Ctx {
  cwd: string;
  dryRun: boolean;
  log: Logger;
  env: Record<string, string>;  // tokens masked in logs
  artifacts: ArtifactStore;     // GHA artifact access
}

export interface PublishResult {
  status: 'published' | 'already-published' | 'skipped';
  url?: string;
  bytes?: number;
}
```

The interface is an internal convenience for testability and consistency
between the three handlers. It is not a public API — callers import
handlers directly by name.

### 7.2 Dispatch

```ts
// src/handlers/index.ts
import { crates } from './crates.js';
import { pypi } from './pypi.js';
import { npm } from './npm.js';

export function handlerFor(kind: string): Handler {
  switch (kind) {
    case 'crates': return crates;
    case 'pypi':   return pypi;
    case 'npm':    return npm;
    default:       throw new Error(`unknown package kind: ${kind}`);
  }
}
```

### 7.3 Error model

Handlers throw typed errors caught by the orchestrator:

- `AuthError` — auth failed; do not retry.
- `TransientError` — 5xx or network; retry up to 3x with exponential
  backoff (1s, 2s, 4s, jitter ±25%).
- Any other thrown error is treated as fatal.

### 7.4 Built-in handler summaries

- **crates** — `cargo publish` + crates.io HEAD-check for idempotency.
  Reads version from Cargo.toml; supports workspace crates via `path`
  pointing at the crate dir.
- **pypi** — supports `maturin`, `setuptools`, and `hatch` build backends.
  Downloads wheels from GHA artifacts (built by user's matrix), publishes
  via `twine` or delegates to `pypa/gh-action-pypi-publish` when OIDC is
  in use. Idempotency via PyPI JSON API (`/pypi/{name}/{version}/json`).
- **npm** — `npm publish --provenance` with OIDC; idempotency via
  `npm view <pkg>@<version> version` exit code.

---

## 8. Adding a New Registry

Pilot has no plugin system. Adding a new registry (Ruby gems, Go modules,
Homebrew, Docker images, etc.) means:

1. Add `src/handlers/<name>.ts` implementing the `Handler` interface.
2. Add a case in `src/handlers/index.ts`.
3. Add unit tests.
4. Add an integration test against a mocked registry.
5. Send a PR.

Benefits of collapsing to internal dispatch:
- One codebase, one version, one test suite.
- No peer-dep compatibility matrix.
- No public API to maintain across minor bumps.
- Refactoring a handler is a local change, not a coordinated release.

If pilot ever sees real demand for third-party registries that can't be
upstreamed, factoring a handler out into a separate package is a
straightforward refactor. v0 does not pay that cost speculatively.

---

## 9. Workflow Shape

### 9.1 Canonical auto-release workflow

User copies this into `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      packages:
        description: "Comma-separated package names to force-release"
        required: false
      bump:
        description: "Version bump (patch|minor|major)"
        required: false
        default: "patch"

jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.plan.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # trailer lookup needs history
      - id: plan
        uses: thekevinscott/put-it-out-there@v0
        with:
          command: plan

  build:
    needs: plan
    if: needs.plan.outputs.matrix != '[]'
    strategy:
      matrix:
        include: ${{ fromJson(needs.plan.outputs.matrix) }}
    runs-on: ${{ matrix.runs_on }}
    steps:
      - uses: actions/checkout@v4
      # --- User-owned build logic below ---
      - if: matrix.kind == 'pypi'
        uses: PyO3/maturin-action@v1
        with:
          command: build
          args: --release --out dist
          working-directory: ${{ matrix.path }}
      - if: matrix.kind == 'crates'
        run: cargo build --release --manifest-path ${{ matrix.path }}/Cargo.toml
      - if: matrix.kind == 'npm'
        run: |
          cd ${{ matrix.path }}
          npm ci
          npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: pilot-${{ matrix.name }}
          path: ${{ matrix.artifact_path }}

  publish:
    needs: [plan, build]
    runs-on: ubuntu-latest
    permissions:
      id-token: write              # OIDC
      contents: write              # tag + release
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/download-artifact@v4
        with: { path: artifacts }
      - uses: thekevinscott/put-it-out-there@v0
        with:
          command: publish
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}       # fallback if no OIDC
          CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}
```

### 9.2 Why three jobs

The `plan` job computes the release matrix from the merge commit's trailer
and path-filter cascade. It emits JSON so the `build` job can fan out across
the user's build tooling (they own this step — pilot doesn't know how to
compile every possible project). The `publish` job then picks up artifacts
and dispatches each to its handler.

### 9.3 PR check workflow

Separate file, `.github/workflows/pilot-check.yml`:

```yaml
on: pull_request

jobs:
  pilot-dry-run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: thekevinscott/put-it-out-there@v0
        with:
          command: plan
          dry_run: true
          fail_on_error: true
```

This surfaces misconfigurations (unknown `kind`, invalid trailer, tag
collision) before the merge.

---

## 10. Release Trailer (Optional Override)

### 10.1 Default behavior: no trailer needed

Every merge to `main` that changes files matching a package's `paths` globs
releases that package at **patch**. No trailer required. This is the 90%
case for LLM-authored, high-cadence projects.

The `release:` trailer exists only to **override** that default in the three
cases where patch-on-cascade is wrong.

### 10.2 Syntax

Trailer lives in the merge commit body. Format follows Git's trailer
conventions (RFC 822-style key/value lines at the end of the commit
message):

```
Add streaming reader API

Adds a chunked reader to dirsql that yields rows lazily instead
of buffering the full result set.

release: minor
```

### 10.3 Grammar

```
trailer     = "release:" WS value [ WS packages ]
value       = "patch" | "minor" | "major" | "skip"
packages    = "[" package-list "]"
package-list = package-name *( "," WS package-name )
```

### 10.4 Values and when to use them

| Value   | Effect                                                               |
|---------|----------------------------------------------------------------------|
| _(omitted)_ | Default. Path-filter match → patch. No match → no release.       |
| `patch` | Same as omitted. Explicit for clarity.                               |
| `minor` | Bump minor for all cascaded packages.                                |
| `major` | Bump major for all cascaded packages.                                |
| `skip`  | Suppress release even if paths match (e.g., typo fix inside code).   |

Optional `[pkg1, pkg2]` suffix scopes the override to specific packages;
unlisted packages follow the default (patch on cascade).

### 10.5 Examples

```
release: minor
```
All packages whose paths matched get minor instead of patch.

```
release: major [dirsql-python]
```
`dirsql-python` bumps major; any other cascaded packages still get patch.

```
release: skip
```
Nothing releases this commit, even if paths matched.

_(no trailer)_
Path-filter cascade runs normally. Matching packages get patch.

### 10.6 Parsing

Uses `git interpret-trailers` when available, with a pure-TS fallback
(`parse-trailers`). Case-insensitive key match. Only the **last**
`release:` line in the commit wins, consistent with git trailer semantics.

### 10.7 Precedence

When `workflow_dispatch` is triggered manually:

1. Manual `packages` + `bump` inputs are **authoritative** — they override
   any trailer and any default cascade logic.
2. If no manual inputs are provided on `workflow_dispatch`, behave as if
   the tip of `main` had `release: patch` (no path filter required —
   manual dispatch is an explicit force-release).
3. On `push` events, path-filter cascade runs unconditionally; the trailer
   on the HEAD commit of `main` may override bump type or skip.

---

## 11. Cascade Algorithm

The cascade is the set of packages that will release on a given commit.
Two inputs: path globs (direct triggers) and `depends_on` (transitive
triggers).

### 11.1 Algorithm

Two-pass fixed-point:

```
Pass 1 (direct):
  for each package P:
    last_tag = resolve_last_tag(P)
    changed  = git diff --name-only $last_tag..HEAD
    if any file in changed matches any glob in P.paths:
      cascade.add(P)

Pass 2 (transitive, until stable):
  repeat until no change:
    for each package P not yet in cascade:
      if any of P.depends_on is in cascade:
        cascade.add(P)
```

Direct path matches and dep-graph matches are unioned. A package with no
direct path match but a `depends_on` that cascades will still release.

### 11.2 Why `depends_on` instead of duplicated globs

Transitive cascade used to be expressed by duplicating the upstream
package's globs into the downstream package's `paths`. That worked for two
packages but scaled poorly — a change to the upstream path meant editing
every downstream config, and silent failure was easy (forget the
duplication → downstream never releases).

`depends_on` makes the graph explicit. One source of truth per path glob;
the dep edge says "I also release when my dep does." Independent packages
leave `depends_on` out entirely — no graph for them.

### 11.3 Cycle detection

If `depends_on` forms a cycle (A → B → A), `pilot plan` fails loud at
validation time. Cycles are a config error; pilot does not try to break
them.

### 11.4 Glob semantics

Globs use `minimatch` with `{ dot: true, matchBase: false }`. Double-star
crosses directory boundaries. Brace expansion enabled.

| Glob                                | Matches                                        |
|-------------------------------------|------------------------------------------------|
| `packages/python/**/*.py`           | any `.py` under `packages/python/`             |
| `packages/python/**`                | any file under `packages/python/`              |
| `packages/{python,rust}/**`         | either subtree                                 |
| `Cargo.lock`                        | exact file at repo root                        |

### 11.5 First release

If no tag matches `{name}-v*.*.*`, diff from the **repo root commit** —
every file in `paths` counts as "changed." The handler uses
`first_version` (default `0.1.0`).

### 11.6 Explicit trailer overrides

The `release:` trailer's optional `[packages, ...]` suffix **forces** the
listed packages to release regardless of the cascade result (see §10.7
for precedence and §10.5 for the full semantics).

---

## 12. Build Step (User-Owned Matrix)

### 12.1 Rationale

Pilot deliberately does not run `cargo build`, `maturin build`, `npm run
build`, or any build-tool. Reasons:

- Every project has idiosyncratic build setups (cross-compile, feature
  flags, bundled native deps). Pilot would either be opinionated
  (excluding valid projects) or become a thin shell around the user's
  `Makefile` (pointless).
- Build matrices require GitHub Actions matrix syntax (`strategy.matrix`)
  which is static YAML, generated from the `plan` output.
- Builds are cacheable via GHA-native mechanisms (setup-actions emit cache
  keys). Pilot would reinvent this badly.

### 12.2 Matrix output contract

`pilot plan` emits this JSON on stdout (and GHA-output `matrix`):

```json
[
  {
    "name": "dirsql-rust",
    "kind": "crates",
    "path": "packages/rust",
    "version": "0.3.4",
    "runs_on": "ubuntu-latest",
    "artifact_path": "packages/rust/target/package/*.crate",
    "artifact_name": "pilot-dirsql-rust"
  },
  {
    "name": "dirsql-python",
    "kind": "pypi",
    "path": "packages/python",
    "version": "0.3.4",
    "runs_on": "${{ matrix.os }}",
    "artifact_path": "packages/python/dist/*.whl",
    "artifact_name": "pilot-dirsql-python"
  }
]
```

The `build` job's matrix expands each row. The user's YAML does the actual
build, keyed on `matrix.kind`.

### 12.3 Platform-matrixed builds (wheels)

For Python/Rust wheels across multiple OS/arch, the user-authored matrix
expands beyond what pilot emits:

```yaml
build-pypi:
  needs: plan
  strategy:
    matrix:
      include: ${{ fromJson(needs.plan.outputs.matrix) }}
      os: [ubuntu-latest, macos-latest, windows-latest]
  ...
```

This is user-authored because pilot has no opinion on which platforms a
package targets.

### 12.4 Artifact handoff

Build job uploads via `actions/upload-artifact@v4` using the `artifact_name`
from the matrix row. Publish job downloads with `actions/download-artifact@v4`
and the handler picks up files from `artifacts/<artifact_name>/` via
`ctx.artifacts.get(pkg.name)`, which returns an absolute path.

---

## 13. Publishing & Idempotency

### 13.1 Per-registry idempotency strategy

| Registry    | Check                                           | Write window            |
|-------------|-------------------------------------------------|-------------------------|
| crates.io   | `GET /api/v1/crates/{name}/{version}` 200 check | Permanent (yank only)   |
| PyPI        | `GET /pypi/{name}/{version}/json` 200 check     | Permanent (no unpublish)|
| npm         | `npm view {name}@{version} version` exit 0      | 72-hour unpublish window|

If `isPublished(version) === true`, the handler returns
`{ status: 'already-published' }` and the run succeeds. This makes retries
safe and lets users re-trigger a failed workflow without consequences.

### 13.2 Retry policy

Applied uniformly by the orchestrator (not per-handler):

```
retries:        3
initial_delay:  1s
multiplier:     2
jitter:         ±25%
retry_on:       TransientError, fetch 5xx, ECONNRESET, ETIMEDOUT
no_retry_on:    AuthError, other errors, 4xx other than 429
```

429 is treated as transient with respect for `Retry-After`.

### 13.3 Publish order

Packages publish in parallel when safe. Ordering is derived from the
`depends_on` graph (§11): if A is in B's transitive `depends_on`, A
publishes before B. Packages with no dep relationship to each other
publish concurrently.

A toposort over `depends_on` produces the order. Because cycles fail
validation (§11.3), the sort is always well-defined.

### 13.4 Failure handling mid-cascade

If package N in a 3-package cascade fails, packages 1..N-1 stay published
(registries don't support rollback anyway). Package N+1..end are skipped.
The run exits non-zero. Re-running after fixing the issue is safe because
of §13.1 idempotency.

### 13.5 Tag creation (no-push model)

Pilot does **not** create or push a synthetic "bump" commit back to main.
Manifest edits live in the CI worktree for the duration of the build and
publish steps only. The tag points at the merge commit that triggered the
release.

Order within a single package's release:

1. **Plan:** compute next version from last tag; `writeVersion()` invoked
   in dry-run mode to validate the edit would succeed.
2. **Build:** CI worktree checked out at the merge commit; `writeVersion()`
   writes the new version into the manifest; user's build tooling
   produces artifacts labeled with it.
3. **Publish:** handler uploads artifacts to the registry.
4. **Tag:** on publish success, `git tag <name>-v<version> <merge_commit_sha>`
   and `git push --tags`. Tag points at the merge commit, not a synthetic
   bump commit.
5. **Release:** GitHub Release created via API (§15).

`main`'s committed manifest stays at whatever version it was before. Next
release reads the last tag (not the manifest) to compute the next version.
Tags are the source of truth; manifests in main are stale and that's
intentional.

Consequences:

- No push race. Ever.
- No `[skip ci]` recursion hack needed.
- No `concurrency: release` group required for correctness (though it's
  still fine to add for UX — serialized runs are easier to read in the
  Actions UI).
- `cargo build` from local main produces an artifact labeled with the
  stale manifest version. Documented as expected behavior; users who
  want local builds labeled with the current version can set manifest
  to `0.0.0-dev` as a sentinel.

---

## 14. Versioning & Tags

### 14.1 Tag format (fixed)

Tags are always `{package.name}-v{version}` — e.g.,
`dirsql-python-v0.3.4`. Per-package tags are required because packages
release independently.

The format is not configurable. If every package released in lockstep
you could argue for a shared `v{version}` tag, but that's not the
supported mode.

### 14.2 Resolving `last_tag`

For each package, `git tag -l '<name>-v*.*.*'` yields candidates. Take
the highest semver-sorted match. Use `git describe --tags --match <glob>`
as a fallback for robustness.

### 14.3 Bump semantics

Given `last_version = 0.3.4` and `release: <bump>`:

| Bump   | Result  |
|--------|---------|
| patch  | 0.3.5   |
| minor  | 0.4.0   |
| major  | 1.0.0   |

Pre-1.0 follows Cargo/npm convention: `minor` zeros patch, `major` bumps
major and zeros minor/patch (the "pre-1.0 = breaking minor bumps" variant is
**not** used; stay strict-semver).

### 14.4 First version

If `last_tag` resolves to nothing for this package, use `package.first_version`
(default `0.1.0`). The `release: <bump>` trailer is effectively ignored — you
always get `first_version` on the first release.

### 14.5 Version-file updates

Handler-owned. Contract:
- Handler reads the current version file.
- If version already equals target, no-op (return `[]`).
- Otherwise, update in-place (in the CI worktree only) and return the
  path list.

Examples of what each handler edits:

| Handler | File(s)                                                               |
|---------|-----------------------------------------------------------------------|
| crates  | `Cargo.toml` (`[package] version`), `Cargo.lock` (`cargo update --workspace`) |
| pypi    | `pyproject.toml` (`[project] version` or tool-specific)               |
| npm     | `package.json` (`version`), `package-lock.json` regenerated           |

These edits live only in the CI worktree. See §13.5 for how the tag is
created without pushing a synthetic bump commit.

---

## 15. GitHub Releases

### 15.1 Per-tag release

For each package published, a GitHub Release is created at the package's
tag with:

- **Title:** `{package_display_name} {version}` (e.g., `dirsql-python 0.3.4`).
- **Body:** auto-generated from `git log <prev_tag>..<this_tag>` filtered to
  commits touching files in `package.paths`. Uses the commit subject lines
  only (no bodies — keeps it short).
- **Assets:** artifacts from the build step, for manual download.
- **Prerelease:** set if version is `-rc`, `-beta`, `-alpha` suffixed
  (not v0 scope, but the flag exists).

### 15.2 Release creation API

Uses `actions/github-script` via the core — no external action dependency.
Handled in the same `publish` job after tags push.

---

## 16. Credentials

**Nothing credential-related lives in `pilot.toml`.** Secrets are stored
as GitHub Actions secrets (repo or org level); the workflow YAML wires
them into the `publish` job as env vars under well-known names; pilot
reads those names directly. There is no indirection field in config —
the connection between `secrets.X` and pilot is the workflow YAML, which
is where credential policy belongs.

### 16.1 OIDC trusted publishing (preferred)

- **PyPI:** configure a trusted publisher in PyPI project settings pointing
  at this repo + workflow file. Pilot's PyPI handler detects OIDC
  availability at runtime (`ACTIONS_ID_TOKEN_REQUEST_TOKEN` present) and
  uses it. Falls back on token if unavailable.
- **npm:** `npm publish --provenance` requires `id-token: write` in the
  job `permissions`. Works with no token at all when OIDC is configured.
- **crates.io:** does **not** support OIDC as of 2026-04; always uses a
  token.

OIDC requires adding `permissions: { id-token: write }` to the publish
job. Pilot does not configure this — the user's workflow does.

### 16.2 Token fallback (well-known env vars)

When OIDC is unavailable or disabled, handlers look for these env vars:

| Registry  | Env var                 |
|-----------|-------------------------|
| crates.io | `CARGO_REGISTRY_TOKEN`  |
| PyPI      | `PYPI_API_TOKEN`        |
| npm       | `NODE_AUTH_TOKEN`       |

The user wires these up in `release.yml`:

```yaml
- uses: thekevinscott/put-it-out-there@v0
  with: { command: publish }
  env:
    CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}
    PYPI_API_TOKEN:       ${{ secrets.PYPI_TOKEN }}
    NODE_AUTH_TOKEN:      ${{ secrets.NPM_TOKEN }}
```

Secret *names* (on the left side of `${{ secrets.X }}`) are the user's
choice; only the env var names on the right are pilot's convention.

### 16.3 Pre-flight check

Before any publish actually runs, pilot verifies that every cascaded
package has usable credentials. Each handler declares the env var(s) it
needs; pilot checks for either (a) OIDC availability or (b) the expected
env var present and non-empty.

Per-handler requirement:

| Handler | Requires                                                        |
|---------|-----------------------------------------------------------------|
| crates  | `CARGO_REGISTRY_TOKEN` (OIDC not supported)                     |
| pypi    | OIDC **or** `PYPI_API_TOKEN`                                    |
| npm     | OIDC **or** `NODE_AUTH_TOKEN`                                   |

If the check fails, the run aborts **before** any side effects (no tag
push, no partial publish) with a message naming the missing env var and
the package that needs it:

```
error: dirsql-rust (crates) needs CARGO_REGISTRY_TOKEN.
  Set it in .github/workflows/release.yml under the publish job:
    env:
      CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}
  See plan.md §16.
```

The same check is the core of `pilot doctor`.

### 16.4 Log safety

Any env var matching `*TOKEN*`, `*SECRET*`, `*PASSWORD*`, or `*KEY*` is
auto-masked in pilot's logs. Values found in `process.env` whose names
match these patterns are redacted before any log line is emitted.

---

## 17. CLAUDE.md / AGENTS.md Integration

### 17.1 The problem

For the trailer convention to work, the LLM agent authoring commits has to
know about it. `pilot init` solves this.

### 17.2 `pilot init`

```
$ pilot init
✓ Wrote pilot.toml (scaffold — edit with your packages)
✓ Wrote pilot/AGENTS.md (trailer convention)
✓ Appended @pilot/AGENTS.md to CLAUDE.md
✓ Wrote .github/workflows/release.yml
✓ Wrote .github/workflows/pilot-check.yml
```

The `@pilot/AGENTS.md` syntax is a reference to CLAUDE.md's `@-import`
mechanism: any line starting with `@` is treated by Claude Code as an
inclusion of that file. The agent reads `pilot/AGENTS.md` transitively.

### 17.3 `pilot/AGENTS.md` contents (generated)

```markdown
# Release signaling for Put It Out There

When you finish a unit of work and are preparing a PR or commit, add a git
trailer to the commit message body to signal a release:

    release: <patch|minor|major|skip>

Rules:
- Omit the trailer for docs-only, CI-only, or internal-only changes.
- `patch` for bug fixes or internal refactors that don't change public API.
- `minor` for new features that are backwards-compatible.
- `major` for breaking changes.
- `skip` to suppress release when path filters would otherwise cascade.

The trailer on the merge commit determines the release. If merging via
"Squash and merge," include the trailer in the PR description so it ends up
in the squashed commit body.
```

### 17.4 Idempotency of `pilot init`

- If `pilot.toml` exists, print a diff and require `--force` to overwrite.
- If `CLAUDE.md` already contains `@pilot/AGENTS.md`, skip the append.
- If `.github/workflows/release.yml` exists, rename to `release.yml.bak`
  before writing (loud and visible).

### 17.5 Variant for non-Claude agents

`pilot init --agent=cursor` writes to `.cursorrules` instead. v0 supports
`claude` (default) and `cursor`. Other agents added on request.

---

## 18. Dry-Run as PR Check

### 18.1 Purpose

Surface release errors while the change is still in review, not after merge.

### 18.2 What the check validates

Running `pilot plan --dry-run` in PR mode (where HEAD is the merge-preview
commit):

1. `pilot.toml` parses and conforms to the schema.
2. Every `[[package]]`'s `kind` maps to a known handler.
3. Every package passes its handler's Zod schema.
4. If a `release:` trailer is present, it parses into a recognized form.
5. Path-filter cascade produces a non-empty set when the trailer is
   non-skip, and vice versa.
6. Computed next version for each cascaded package does not collide with an
   existing tag.
7. Handler-specific pre-publish checks (e.g., crates handler verifies the
   crate name is available or owned by the author via `cargo owner --list`).

### 18.3 Exit codes

- `0` — clean. Check passes.
- `1` — config or handler error. Fix before merging.
- `2` — trailer missing or malformed. Add it to the PR.
- `3` — no cascade despite non-skip trailer. Likely forgot to include paths.

### 18.4 GitHub check output

Writes a job summary (via `$GITHUB_STEP_SUMMARY`) showing:

```
Packages to release on merge:
  - dirsql-rust     0.3.4 → 0.3.5  (crates.io)
  - dirsql-python   0.3.4 → 0.3.5  (pypi)
Skipped (no matching path changes):
  - dirsql-cli      (last: 0.3.4)
```

---

## 19. When a Release Goes Bad

Pilot intentionally does **not** ship a `rollback` command. Republishing
old code under a new version number misleads consumers with `>=` pins:
they upgrade expecting forward motion and silently get older behavior.
That's worse than the disease.

Use the registries' own primitives:

- **crates.io:** `cargo yank --vers X.Y.Z` — marks the version as
  don't-resolve-to-this. Consumers pinned `>=X.Y.Z` fall back to the last
  good version until a real fix ships. Never deletes code.
- **PyPI:** yank via the web UI or `twine` — same semantics as crates.io.
- **npm:** `npm deprecate <pkg>@<version> "<reason>"` prints a warning to
  installers. Within the 72-hour window, `npm unpublish` is available but
  should be avoided — it breaks anyone who's already pulled the version.

The correct "rollback" path when a release goes bad:

1. `git revert` the problem commit on a branch, PR, merge.
2. Pilot ships the revert as a normal patch (e.g., `0.1.46` containing
   the known-good behavior).
3. Yank/deprecate `0.1.45` on the registry so installers skip it.

This gives consumers monotonic version numbers and correct resolution
semantics. It also keeps pilot's scope small — registry-side actions are
one-shot operator commands, not workflow primitives.

---

## 20. Post-Release Verifier

### 20.1 Purpose

Catch "it published but it's broken" — a version appears on the registry
but can't be installed, imported, or initialized.

### 20.2 Mechanism

After a successful publish, each handler may implement `smokeTest()`. The
default implementation is shell-in-container:

```
docker run --rm <base_image> sh -c "
  <install_cmd>
  <pkg.smoke>
"
```

Where `base_image` and `install_cmd` are handler-supplied defaults:

| Handler | Base image         | Install command                       |
|---------|--------------------|---------------------------------------|
| crates  | `rust:slim`        | `cargo install {crate} --version {v}` |
| pypi    | `python:3.12-slim` | `pip install {pypi}=={v}`             |
| npm     | `node:20-alpine`   | `npm i {name}@{v}`                    |

The user's `package.smoke` runs after install. Examples:

```toml
[[package]]
name   = "dirsql-python"
kind   = "pypi"
smoke  = "python -c 'import dirsql; dirsql.DirSQL'"
```

### 20.3 Failure handling

Smoke test failure does **not** unpublish (it usually can't). It:
- Fails the publish job loudly.
- Opens a GitHub issue (`pilot: smoke test failed for dirsql-python 0.3.5`)
  if `pilot.smoke_opens_issue = true`.
- Suggests yanking/deprecating the broken version and preparing a
  `git revert` patch release (§19).

### 20.4 Timing

Registry CDN propagation is non-zero. The verifier retries the install up
to 3 times with 10s spacing before declaring failure.

### 20.5 Opt-out

`pilot.smoke_test = false` disables globally. Individual packages can
disable by omitting `smoke`.

---

## 21. Command Surface (`pilot` CLI)

All commands also runnable via `npx pilot <cmd>` if not installed
globally.

### 21.1 Commands

```
pilot init                      Scaffold pilot.toml, workflows, AGENTS.md
pilot plan                      Print release plan for HEAD (dry-run by default)
pilot plan --dry-run            Explicit dry-run (no side effects)
pilot plan --json               JSON output for CI
pilot publish                   Execute the plan (CI-intended)
pilot status                    Show last released version per package
pilot doctor                    Validate config + handlers + auth
pilot version                   Print CLI version
```

### 21.2 Global flags

```
--config <path>      Path to pilot.toml (default: ./pilot.toml)
--cwd <path>         Working directory (default: cwd)
--quiet              Warnings and errors only
--verbose            Debug logs
--log-format json    Structured logs for CI log ingesters
```

### 21.3 Exit code convention

| Code | Meaning                                    |
|------|--------------------------------------------|
| 0    | Success                                    |
| 1    | User error (bad config, missing trailer)   |
| 2    | Handler error (auth, registry 4xx)         |
| 3    | Transient error exhausted retries (5xx)    |
| 4    | Environment error (git unavailable, etc.)  |
| 10+  | Reserved for future use                    |

---

## 22. State & Logs

### 22.1 State is in git

Pilot stores **no external state**. Everything it needs is either in
`pilot.toml` or recoverable from:

- `git tag` — for last-published version per package.
- `git log` — for the release trailer and file changes.
- Registry API — for publish idempotency.

This makes `pilot` a pure function of the git history and registry state.
Re-running it always produces the same result for the same input.

### 22.2 Logs

Logs are structured and go to stdout (CI-friendly):

```
{"ts": "2026-04-17T18:22:04Z", "level": "info", "pkg": "dirsql-python",
 "phase": "publish", "version": "0.3.5", "msg": "uploaded wheel",
 "bytes": 124567}
```

In `--log-format=text` (default for interactive terms), these render as:

```
→ dirsql-python  0.3.5  publish  uploaded wheel (124 KB)
```

### 22.3 Artifacts saved by the workflow

The `publish` job uploads a `pilot-release-log.json` artifact with the full
run record — plan, computed versions, handler outputs, timings. Useful
for debugging failed runs without re-running them.

---

## 23. Testing Strategy

Follows the same layered strategy used in `dirsql`. Non-negotiable.
Red → green TDD for everything; tests are written before the
implementation. Target coverage: **90%+**.

### 23.1 Architectural precondition: CLI is a thin wrapper

The `pilot` package exports a JS SDK (library API) **and** a CLI binary.
The CLI is ~50 lines: argv parsing, process-level concerns (exit codes,
stdin/stdout), and a call into the SDK. All logic lives in the SDK.

This is load-bearing for the test strategy: the SDK is the primary
testable surface, and the CLI gets a small set of smoke tests rather
than a full test pyramid.

### 23.2 Unit tests (colocated)

- **Location:** colocated with the code under test. `src/cascade.ts` →
  `src/cascade.test.ts`, etc.
- **Scope:** a single function or a tight cluster. Mock **everything**
  but the function under test — fs, git, network, clock, env, and any
  in-repo collaborator.
- **Runner:** vitest.
- **Covers:** every pure function — trailer parser, version bumper,
  cascade calculator, glob matcher, tag resolver, retry policy, config
  loader, handler pure helpers.

### 23.3 Integration tests (SDK level)

- **Location:** `test/integration/`.
- **Target:** the exported JS SDK, not the CLI.
- **Mocks:** anything **external to this library** — network, git
  (where appropriate), filesystem for large fixtures, registry APIs.
  In-repo modules are not mocked at this layer.
- **Registry mocks:**
  - npm — `verdaccio` running in-process.
  - PyPI — `pypiserver` or `msw`-stubbed HTTP.
  - crates.io — `msw`-stubbed HTTP.
- **Covers:** full publish flows end-to-end through the SDK, including
  cascade → build-matrix emit → handler dispatch → idempotency → retry
  → tag computation. No real network, no real registries.

### 23.4 End-to-end tests (agent-run, not CI)

- **Mocks:** nothing. Real everything.
- **Entry point:** the `pilot` CLI binary, invoked via `execa` or
  equivalent.
- **Registry targets:**
  - **PyPI** — [TestPyPI](https://test.pypi.org) (test instance).
  - **npm** — a dedicated canary package, `pilot-canary`, on real
    npmjs.com. Published + unpublished as part of the test.
  - **crates.io** — no test instance exists, so a dedicated canary
    crate, `pilot-canary`, on real crates.io. Each e2e run bumps a
    monotonic patch version; old versions are yanked periodically.
- **Not run in CI.** The e2e suite:
  - Hits external services (flaky if CI runs it on every push).
  - Costs real registry state (crates.io in particular can't be reset).
  - Can take minutes to run serially.
- **Run often by the agent** during development. Typical cadence: every
  meaningful change to handler or publish code.
- **Entry:** `pnpm test:e2e` or equivalent.

### 23.5 TDD red/green

Every PR that changes release logic must include tests written first.
Workflow:

1. Write a failing test that describes the new behavior.
2. Verify it fails (red).
3. Implement minimally until it passes (green).
4. Refactor with tests still green.

CI lint rejects PRs that modify `src/` without touching a test file.

### 23.6 Coverage

Target **90%+** line and branch coverage across `src/`. Reported by
vitest's built-in c8 integration. CI fails if a PR drops coverage
below 90%. Exclusions (narrow, justified, commented):

- CLI argv parser glue (covered by e2e).
- Shell-out glue in handlers when the external command is trivially
  constructed (covered by integration).

---

## 24. Distribution

### 24.1 npm package

One published package: `pilot`. Contains the CLI, the handler
modules, and everything else. Single version, single release cadence.

### 24.2 The action

Published as `thekevinscott/put-it-out-there@v0` — GitHub consumes from the
repo directly. Bundled with `@vercel/ncc` into `dist/index.js` + `action.yml`.
A release workflow on this repo tags `v0`, `v0.1.x`, etc.

### 24.3 Global install

```
npm i -g pilot
```

Or `npx pilot <cmd>` for one-off use.

### 24.4 First-run for new users

```
cd my-monorepo
npx pilot init
# edit pilot.toml
git add . && git commit -m "chore: add pilot

release: skip"
git push
# first real release:
git commit -m "feat: add X

release: minor"
git push
```

---

## 25. v0 MVP Scope

Explicit cut list. v0 ships when **all** of these work end-to-end on the
reference `examples/rust-python-ts/` repo:

### 25.1 In scope

- [x] `pilot.toml` parsing and schema validation
- [x] Trailer parsing (`release: patch|minor|major|skip [packages]`)
- [x] Cascade: paths + `depends_on` (two-pass fixed-point)
- [x] Three built-in handlers (crates, pypi, npm) dispatched internally
- [x] OIDC and token auth for each registry
- [x] Idempotency check + retry per registry
- [x] Version-file updates (Cargo.toml, pyproject.toml, package.json)
- [x] Tag creation + GitHub Release per package
- [x] `pilot init` (Claude variant only)
- [x] `pilot plan` / `plan --dry-run`
- [x] `pilot publish`
- [x] Dry-run PR check workflow
- [x] Structured logs
- [x] `pilot doctor`

### 25.2 Explicitly out of v0

- [ ] Post-release smoke tests — design locked (§20), deferred.
- [ ] `pilot changelog` — not designed.
- [ ] Non-Claude agent variants for `pilot init`.
- [ ] Private registry support.
- [ ] Pre-release dist-tags (rc, beta, alpha).
- [ ] Hotfix branches.
- [ ] `pilot status` dashboard.

### 25.3 Success criteria

v0 is "done" when:

1. The dirsql monorepo (user's canonical use case) releases cleanly via
   pilot, replacing whatever ad-hoc script it has today.
2. The `examples/rust-python-ts/` reference repo publishes cleanly to all
   three registries on a real cadence — this is the polyglot validation
   path, since the pilot repo itself only exercises npm.
3. Full publish cycle completes successfully on the reference repo.
   Wall-clock is bounded by the user's build (pilot doesn't own compile
   time); pilot's own overhead should be minimal (action cold start +
   registry calls).
4. Adding a new handler (e.g., for Ruby gems) takes under a day for
   someone familiar with the target registry — one file under
   `src/handlers/`, one switch case, tests.
5. README walkthrough is reproducible by someone who has never seen pilot
   in under 30 minutes.

---

## 26. v0.1+ Roadmap

Ordered roughly by likely-value, not commitment. Items move into v0.2, v0.3
etc. based on dogfooding outcomes.

### 26.1 v0.1 (quick follow-ups)

- Post-release smoke tests (§20).
- `pilot changelog` — generate markdown release notes from PR titles and
  bodies since last tag.
- `pilot init --agent=cursor`, `--agent=copilot` variants.

### 26.2 v0.2

- Pre-release dist-tags (`-rc.N`, `-beta.N`, `-alpha.N`) with dedicated
  bump command: `release: prerelease`.
- `pilot status` — dashboard command showing last-released version,
  pending cascade, outstanding failures.

### 26.3 v0.3+

- Private registry support (self-hosted crates registry, private PyPI,
  GitHub Packages for npm).
- Hotfix branches with back-port tooling.
- Scheduled/batched release mode (opposite of v0's immediate mode).
- Additional built-in handlers: Ruby gems, Go modules (if/when Go moves
  to a first-class registry), Docker images, Homebrew taps.
- Multi-repo orchestration (one `pilot.toml` pointing at multiple repos).

---

## 27. Worked Example

A complete reference monorepo shape that v0 must support.

### 27.1 Repo layout

```
dirsql/
├── pilot.toml
├── pilot/
│   └── AGENTS.md
├── CLAUDE.md                       # imports @pilot/AGENTS.md
├── .github/workflows/
│   ├── release.yml
│   └── pilot-check.yml
├── packages/
│   ├── rust/                       # dirsql crate
│   │   ├── Cargo.toml
│   │   └── src/
│   ├── python/                     # dirsql PyPI package (wraps rust)
│   │   ├── pyproject.toml
│   │   └── src/
│   └── ts/                         # dirsql-cli npm package
│       ├── package.json
│       └── src/
└── README.md
```

### 27.2 `pilot.toml`

```toml
[pilot]
version     = 1
agents_path = "pilot/AGENTS.md"

[[package]]
name          = "dirsql-rust"
kind          = "crates"
path          = "packages/rust"
paths         = [
  "packages/rust/**/*.rs",
  "packages/rust/Cargo.toml",
  "Cargo.lock",
]
first_version = "0.1.0"

[[package]]
name          = "dirsql-python"
kind          = "pypi"
path          = "packages/python"
pypi          = "dirsql"
paths         = ["packages/python/**"]
depends_on    = ["dirsql-rust"]       # PyO3 wrapper: Rust changes cascade
build         = "maturin"
first_version = "0.1.0"
smoke         = "python -c 'import dirsql; dirsql.DirSQL'"

[[package]]
name          = "dirsql-cli"
kind          = "npm"
path          = "packages/ts"
npm           = "dirsql-cli"
paths         = ["packages/ts/**"]
access        = "public"
first_version = "0.1.0"
smoke         = "dirsql --version"
```

Credentials are set up in `release.yml` (GHA secrets → env), not here.
See §16.

### 27.3 Merge scenarios

**Scenario A: change a `.rs` file, merge PR with no trailer.**

- Path-filter cascade: `dirsql-rust` (direct match), `dirsql-python`
  (transitive via `packages/rust/**`).
- Default bump: patch for both.
- Result: `dirsql-rust@0.1.4`, `dirsql-python@0.1.8`.
- `dirsql-cli` untouched (no path match).

**Scenario B: fix a typo in `packages/python/README.md`, commit with
`release: skip`.**

- Path-filter cascade: `dirsql-python`.
- Trailer overrides: skip.
- Result: nothing releases.

**Scenario C: add breaking change to npm CLI, commit with
`release: major [dirsql-cli]`.**

- Path-filter cascade: `dirsql-cli`.
- Trailer: major, scoped.
- Result: `dirsql-cli@1.0.0`.

**Scenario D: `workflow_dispatch` with `bump=minor`, no packages input.**

- Cascade ignored; all packages release at minor.
- Result: `dirsql-rust@0.2.0`, `dirsql-python@0.2.0`, `dirsql-cli@0.2.0`.

### 27.4 Excerpt: `release.yml`

(Full version in §9.1; abbreviated here.)

```yaml
jobs:
  plan:
    outputs: { matrix: ${{ steps.p.outputs.matrix }} }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - id: p
        uses: thekevinscott/put-it-out-there@v0
        with: { command: plan }

  build:
    needs: plan
    strategy:
      matrix:
        include: ${{ fromJson(needs.plan.outputs.matrix) }}
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - if: matrix.kind == 'pypi'
        uses: PyO3/maturin-action@v1
        with:
          command: build
          args: --release --out dist
          working-directory: ${{ matrix.path }}
      # ...
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact_name }}-${{ matrix.os }}
          path: ${{ matrix.artifact_path }}

  publish:
    needs: [plan, build]
    permissions: { id-token: write, contents: write }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/download-artifact@v4
      - uses: thekevinscott/put-it-out-there@v0
        with: { command: publish }
```

---

## 28. Open Questions

Items the v0 design intentionally does not resolve; answers will emerge
from dogfooding.

### 28.1 Monorepo vs. multirepo

Pilot v0 assumes a single monorepo with one `pilot.toml`. The alternative
(many single-package repos) is already well-served by existing per-ecosystem
tooling. An open question: when does the monorepo overhead stop being
worth it? Probably not pilot's problem to solve, but we should notice if
users are reaching for both pilot and tools like `release-please` in the
same repo.

### 28.2 Build caching

The user-authored build step will benefit from GHA caching (`actions/cache`,
language-specific setup actions). Pilot currently has no opinion on this
— the workflow example shows naive builds. As the reference examples grow,
we'll document recommended cache patterns but **not** implement caching
inside pilot itself.

### 28.3 Signed tags

`pilot.tag_sign = true` (config not yet added) would enable GPG-signed
tags via the GHA action's GPG import step. Deferred until asked. Signed
commits are moot — pilot doesn't create commits in the no-push model
(§13.5).

### 28.4 How opinionated should handler defaults be?

Example: the pypi handler could auto-detect the build backend from
`pyproject.toml` (`tool.maturin`, `tool.setuptools`, `tool.hatch`) and
pick sensible defaults. v0 requires explicit `build = "maturin"` in the
package config. Might relax later.

### 28.5 Two PRs merging in quick succession

Both trigger `release.yml`. In the no-push model (§13.5) there is no
synthetic commit and no push race — each run tags its own merge commit
independently, and the tags are unique per commit SHA. GHA's
`concurrency: release` group is still recommended purely for UX
(serialized logs), not for correctness.

### 28.6 Multi-registry dual-publishing

Some packages want to ship to both npm and GitHub Packages, or crates.io
and a private mirror. Not in v0. Would be handled by adding a dual-target
handler or extending the existing npm handler with a config option —
either way a code change in this repo, not an external package.

---

## 29. Risks & Mitigations

### 29.1 "A registry changes its API and pilot breaks."

**Likelihood:** Medium (crates.io/PyPI/npm all actively evolving).
**Impact:** High (release workflow broken).
**Mitigation:**
- Handler modules localize registry-specific code; fix is a one-file PR.
- Weekly canary publish (§23.4) catches drift before users hit it.
- Patch release of `pilot` rolls the fix out to everyone.

### 29.2 "OIDC configuration is fiddly and scares users off."

**Likelihood:** High.
**Impact:** Medium (users fall back to tokens, which is still fine).
**Mitigation:**
- `pilot doctor` explicitly diagnoses OIDC misconfiguration with exact
  fix steps (URLs, repo settings).
- Token fallback is documented as first-class, not second-class.
- `pilot init` writes tokens-only workflows by default and surfaces the
  OIDC upgrade path in a follow-up tip.

### 29.3 "Trailer convention is a conceptual hurdle for new users."

**Likelihood:** Medium.
**Impact:** Medium (they get releases they didn't expect, or miss bumps).
**Mitigation:**
- Path-filter cascade handles the 90% case with no trailer needed.
- `pilot init` writes `pilot/AGENTS.md` which explains the trailer for
  LLM agents.
- Dry-run PR check surfaces "this will auto-release" before merge so
  surprises are caught early.

### 29.4 "Handlers accumulate `if ecosystem ==` forks."

**Likelihood:** Medium as handlers grow.
**Impact:** Low (internal code quality issue).
**Mitigation:**
- Keep handlers small; shared primitives (OIDC token fetch, retry, docker
  smoke-test) live in `src/` utils, not duplicated.
- If a handler crosses ~500 lines, that's a signal to split or refactor.

### 29.5 "Registry outage mid-cascade publishes half the packages."

**Likelihood:** Medium (crates.io and PyPI both have ~hours/year outages).
**Impact:** Medium (inconsistent state across registries).
**Mitigation:**
- Idempotency check (§13.1) lets re-runs safely skip already-published
  packages.
- Cascade order is deterministic, so a re-run picks up exactly where it
  left off.
- Log includes "N of M published" summary for debugging.

### 29.6 "Rust+Python PyO3 wheel builds are slow and platform-matrixed."

**Likelihood:** Guaranteed for any Rust-backed Python package.
**Impact:** Medium (release takes 20-30 minutes instead of 5).
**Mitigation:**
- User-owned build matrix means they choose how much to parallelize.
- Reference example shows `maturin-action` with cross-compile.
- Not pilot's problem to solve the build-speed question.

### 29.7 "npm provenance / OIDC requires repo metadata in package.json."

**Likelihood:** High the first time.
**Impact:** Low (clear error message).
**Mitigation:**
- The npm handler validates the `repository` field in `package.json`
  pre-publish and fails loudly if missing with a fix-it hint.

---

## 30. Appendix A: Why Not X?

Short case against each alternative considered.

### 30.1 Why not release-please?

- Release-PR model introduces review friction that doesn't fit a solo
  maintainer merging LLM output.
- Excellent at monorepo versioning but prescribes conventional-commits
  rigidly.
- Doesn't publish to crates.io (as of 2026-04). Adds PyPI and npm with
  extra adapters.

### 30.2 Why not changesets?

- Per-change `.md` file authoring is pure overhead when every commit is
  already a deliberate unit of work.
- Primarily npm-focused; PyPI/crates.io are second-class.
- Release-PR model again.

### 30.3 Why not semantic-release?

- Conventional commits enforced rigidly; one malformed commit fails the
  pipeline.
- Plugin ecosystem is large but inconsistent quality.
- Not designed for polyglot; one repo-one-package is the happy path.

### 30.4 Why not Knope?

- Release-PR model.
- Built around a specific workflow (Knope's own "release stages") that
  doesn't generalize cleanly.

### 30.5 Why not Cranko?

- Closest in philosophy (monorepo, polyglot, explicit intent).
- Requires the `rc:` branch convention with merge-to-rc → review → merge-to-main
  flow. Extra ceremony for solo maintainers.
- Rust-centric; Python/npm support exists but is less polished.

### 30.6 Why not roll your own scripts?

- Each registry's auth, idempotency, and retry logic is non-trivial.
- Version-file updates (Cargo.toml / pyproject.toml / package.json) are
  ecosystem-specific and easy to get subtly wrong.
- Every team re-solves the same problem; pilot's thesis is that a small,
  shared tool with plugin seams beats N bespoke bash scripts.

### 30.7 Why not GoReleaser?

- Go-specific; multi-ecosystem is nominal.
- Config shape (`.goreleaser.yml`) assumes Go binaries as the primary
  artifact.

### 30.8 Why not Nx / Turborepo release plugins?

- Tied to the Nx/Turborepo build systems. Pilot intentionally does not
  own the build system — users pick their own (bazel, make, native
  cargo/pip/npm, etc.).

---

_End of v0 plan._

Feedback welcome on the branch or via issues against
https://github.com/thekevinscott/put-it-out-there.
