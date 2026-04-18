# Put It Out There — Comprehensive Plan

> **Status:** v0 design doc. Locked decisions below are locked for v0; the
> roadmap sections call out what is deliberately deferred.
>
> **Repo:** https://github.com/thekevinscott/put-it-out-there
> **CLI:** `pilot`
> **npm scope:** `@pilot/`
> **Date:** 2026-04-17

---

## Table of Contents

1. [Overview](#1-overview)
2. [First-Principles Rationale](#2-first-principles-rationale)
3. [Non-Goals](#3-non-goals)
4. [Glossary](#4-glossary)
5. [System Architecture](#5-system-architecture)
6. [Config Schema (`pilot.toml`)](#6-config-schema-pilottoml)
7. [Plugin Interface](#7-plugin-interface)
8. [Plugin Discovery & Loading](#8-plugin-discovery--loading)
9. [Workflow Shape](#9-workflow-shape)
10. [Release Trailer Convention](#10-release-trailer-convention)
11. [Path-Filter Cascade](#11-path-filter-cascade)
12. [Build Step (User-Owned Matrix)](#12-build-step-user-owned-matrix)
13. [Publishing & Idempotency](#13-publishing--idempotency)
14. [Versioning & Tags](#14-versioning--tags)
15. [GitHub Releases](#15-github-releases)
16. [Credentials (OIDC + Tokens)](#16-credentials-oidc--tokens)
17. [CLAUDE.md / AGENTS.md Integration](#17-claudemd--agentsmd-integration)
18. [Dry-Run as PR Check](#18-dry-run-as-pr-check)
19. [Rollback Primitive](#19-rollback-primitive)
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

Pilot's thesis: the release signal should be a **git trailer on the merge
commit**, the cascade should be determined by **path filters declared by each
package**, and the publishing step itself should be **pluggable per registry**
so the tool stays small and testable while handling the ugly parts (OIDC
auth, idempotency, retries, version-file edits) consistently.

### Shape of the solution

```
┌────────────────────────────────────────────────────────┐
│ GitHub Actions workflow (user-authored release.yml)    │
│  └─ uses: thekevinscott/put-it-out-there@v0            │
│       │                                                 │
│       ▼ (thin TS wrapper; ~100ms cold start)           │
│     @pilot/pilot-core  ◄── reads pilot.toml             │
│       │                                                 │
│       ├─► @pilot/pilot-crates  (Rust → crates.io)       │
│       ├─► @pilot/pilot-pypi    (Python → PyPI)          │
│       └─► @pilot/pilot-npm     (TS/JS → npm)            │
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

### 2.3 Why path filters (instead of a cascade graph)

Cross-language dependencies (Python package wrapping a Rust crate via PyO3,
for instance) can't be expressed in Cargo.toml or pyproject.toml. Asking the
user to maintain a separate cascade graph duplicates that knowledge.

Instead, each package declares the glob patterns that affect it. If the Python
package wraps Rust, its `paths` array includes both `packages/python/**/*.py`
and `packages/rust/**`. Changes to the Rust crate naturally trigger a Python
re-release. No graph traversal, no implicit ordering — just "did any of my
source paths change since the last release of this package?"

### 2.4 Why pluggable publishing

Each registry has its own sharp edges:

- **crates.io:** yank-but-never-delete; version-immutable; requires Cargo.toml edit + `cargo publish`.
- **PyPI:** same permanence; OIDC trusted publishing via `pypa/gh-action-pypi-publish`; wheels per-platform via maturin/cibuildwheel.
- **npm:** 72-hour unpublish window; OIDC provenance; `package.json` version bump; supports pre-release dist-tags.

A monolithic publisher would accumulate `if ecosystem == "x"` forks. Plugins
let each registry's logic live in a small, focused, separately-versioned
package while the core handles the shared work (parsing trailers, computing
versions, managing tags, running dry-run checks).

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
  config and plugins, not in a plan-JSON seam between stages. If a user
  wants fundamentally different release logic, they don't use pilot for
  that step — that's a feature, not a bug.
- **Monorepo tooling it doesn't own.** Nx, Turborepo, Pants, Bazel integration
  is out of scope. Pilot reads `pilot.toml` and does the release; the user's
  build system does the build.

---

## 4. Glossary

| Term              | Meaning                                                                                       |
|-------------------|-----------------------------------------------------------------------------------------------|
| **Package**       | One row in `[[package]]` — a publishable unit (one crate, one wheel-set, one npm package).    |
| **Plugin**        | An npm module implementing the plugin interface for one registry (`@pilot/pilot-crates`, etc).  |
| **Release trailer** | A `release: patch|minor|major` line in the merge commit message body.                         |
| **Cascade**       | The set of packages whose `paths` globs intersect the changed files since last release.        |
| **Idempotency check** | Plugin-side check: "is this version already published?" If yes, skip cleanly.             |
| **Dry-run**       | `pilot plan --dry-run`: resolves versions and prints the publish graph without side effects.   |
| **Smoke test**    | Post-release check: install the published artifact in a clean env, run a user-defined snippet. |

---

## 5. System Architecture

### 5.1 Components

```
put-it-out-there/                         ← this repo
├── action.yml                            ← GitHub Action entry (type: node20)
├── src/
│   ├── action/                           ← thin TS wrapper invoked by GHA
│   │   └── main.ts                       ← parses inputs, invokes core
│   ├── core/                             ← @pilot/pilot-core
│   │   ├── config.ts                     ← pilot.toml loader + schema
│   │   ├── cascade.ts                    ← path-filter → package set
│   │   ├── trailer.ts                    ← parse `release:` from merge commit
│   │   ├── version.ts                    ← bump logic, tag formatting
│   │   ├── plugin.ts                     ← plugin interface + loader
│   │   ├── registry.ts                   ← built-in plugin registry
│   │   ├── git.ts                        ← git wrapper (tag, log, trailer)
│   │   ├── state.ts                      ← read last-published tags
│   │   └── run.ts                        ← top-level orchestration
│   └── cli/                              ← @pilot/pilot
│       └── bin.ts                        ← yargs/commander entry
└── plugins/
    ├── crates/                           ← @pilot/pilot-crates
    ├── pypi/                             ← @pilot/pilot-pypi
    └── npm/                              ← @pilot/pilot-npm
```

### 5.2 Runtime shape

The GHA action is a **native JS action** (not a composite shell action, not a
Docker action). Rationale:

| Action type    | Cold start       | Ergonomics for plugins                     |
|----------------|------------------|--------------------------------------------|
| Docker         | 30–60s           | Plugin system requires in-container npm i  |
| Composite shell| 1–3s             | Hard to pass structured data between steps |
| Node (JS)      | ~100ms           | npm module system → natural plugin host    |

At runtime:

1. GHA invokes `dist/action.js` (bundled via `@vercel/ncc`).
2. Wrapper parses action inputs (command, optional overrides) and invokes
   `pilot-core` directly in-process.
3. Core loads `pilot.toml`, resolves plugins from `node_modules` or from the
   user's repo (if they have a `package.json`).
4. Core computes the cascade and dispatches to plugins.

For local use, the same `pilot-core` is reachable via the `pilot` CLI which
users install globally (`npm i -g @pilot/pilot`) or via `npx @pilot/pilot`. The
GHA and CLI share identical execution paths — `pilot plan` in CI and locally
produce the same output.

### 5.3 Why the action wrapper is thin

The wrapper is intentionally about 50 lines: read `INPUT_COMMAND`, set env
for auth tokens, call `pilotRun(command, cwd)`, surface exit code. All
business logic lives in `pilot-core`, so:

- Testability: no GHA mocks needed for unit tests.
- Portability: the same logic runs in other CI systems if ever needed
  (not an explicit v0 goal, but a useful side-effect).
- Upgradability: bumping the action (`uses: ...@v0` → `...@v1`) doesn't
  require users to also reinstall a CLI; the action pins its own
  `pilot-core` version.

---

## 6. Config Schema (`pilot.toml`)

TOML chosen for ergonomic nested arrays and existing familiarity (Cargo.toml,
pyproject.toml). The file lives at the repo root.

### 6.1 Top-level

```toml
[pilot]
version          = 1                         # schema version (required)
default_branch   = "main"                    # release branch
tag_format       = "v{version}"              # or "{package}-v{version}"
commit_sign      = false                     # sign the version-bump commit?
require_trailer  = false                     # if true, missing trailer fails PR check
agents_path      = "pilot/AGENTS.md"         # where `pilot init` writes the trailer doc
```

### 6.2 `[[package]]` entries

Each publishable unit gets one entry. Field reference:

```toml
[[package]]
name    = "dirsql-python"                    # unique pilot-internal name
kind    = "pypi"                             # plugin discriminator
path    = "packages/python"                  # working dir for build/publish
paths   = [                                  # cascade triggers (globs)
  "packages/python/**/*.py",
  "packages/python/pyproject.toml",
  "packages/rust/**",
]

# Registry-specific:
pypi    = "dirsql"                           # name on PyPI (may differ from name)
build   = "maturin"                          # build recipe (plugin-interpreted)
smoke   = "python -c 'import dirsql; dirsql.DirSQL'"

# Versioning:
tag_format  = "python-v{version}"            # overrides pilot.tag_format
first_version = "0.1.0"                      # initial version if no tag exists

# Auth:
auth = "oidc"                                # "oidc" | "token"
token_env = "PYPI_TOKEN"                     # used when auth = "token"
```

### 6.3 Field reference (all packages)

| Field            | Required | Type         | Default           | Notes                                            |
|------------------|----------|--------------|-------------------|--------------------------------------------------|
| `name`           | yes      | string       | —                 | Unique within the repo                           |
| `kind`           | yes      | string       | —                 | `crates` \| `pypi` \| `npm` (extensible)          |
| `path`           | yes      | string       | —                 | Working directory; relative to repo root         |
| `paths`          | yes      | [string]     | —                 | Glob patterns for cascade                        |
| `tag_format`     | no       | string       | `pilot.tag_format`| `{version}` and `{package}` interpolation        |
| `first_version`  | no       | string       | `0.1.0`           | Semver                                           |
| `auth`           | no       | string       | `oidc`            | `oidc` \| `token`                                 |
| `token_env`      | if token | string       | —                 | Env var holding the token                        |
| `smoke`          | no       | string       | —                 | Shell command run post-publish in clean env      |

### 6.4 Plugin-specific fields

Each plugin documents its own fields. The core does **no** validation of
fields outside its top-level reference; it passes the raw TOML sub-table to
the plugin. Plugins that need schema validation use Zod (shipped alongside
core).

Examples:

- **`@pilot/pilot-crates`**: `crate` (crates.io name if differs), `features`,
  `target` (publishing target triple list).
- **`@pilot/pilot-pypi`**: `pypi`, `build` (`maturin` \| `setuptools` \| `hatch`),
  `wheels_artifact` (artifact name to download from build matrix).
- **`@pilot/pilot-npm`**: `npm` (package name if differs), `access`
  (`public` \| `restricted`), `tag` (dist-tag, default `latest`).

---

## 7. Plugin Interface

All plugins implement a single default-exported object conforming to this TS
interface (shipped from `@pilot/pilot-core/types`):

```ts
export interface PilotPlugin {
  /** Registered kind; must match `package.kind` in pilot.toml */
  kind: string;

  /** Validate plugin-specific fields against this plugin's expectations. */
  validate(pkg: PackageConfig): ValidationResult;

  /**
   * Query the registry: is this exact version already live?
   * Must be safe to retry; must not require write credentials.
   */
  isPublished(
    pkg: PackageConfig,
    version: string,
    ctx: PluginContext,
  ): Promise<boolean>;

  /**
   * Update the version-file(s) inside `pkg.path` to `version`.
   * Returns the list of modified file paths.
   * MUST be deterministic and idempotent.
   */
  writeVersion(
    pkg: PackageConfig,
    version: string,
    ctx: PluginContext,
  ): Promise<string[]>;

  /**
   * Publish the package at `version`. Throws on hard failure; returns
   * cleanly on already-published (idempotent) or success.
   * Responsible for: auth, artifact collection, retry on 5xx.
   */
  publish(
    pkg: PackageConfig,
    version: string,
    ctx: PluginContext,
  ): Promise<PublishResult>;

  /**
   * Optional: run a smoke test in a clean environment.
   * Default implementation: shell-exec `pkg.smoke` inside a throwaway
   * container (Docker) with the package freshly installed.
   */
  smokeTest?(
    pkg: PackageConfig,
    version: string,
    ctx: PluginContext,
  ): Promise<SmokeResult>;
}

export interface PluginContext {
  cwd: string;                 // repo root
  dryRun: boolean;
  log: Logger;
  env: Record<string, string>; // filtered env (tokens masked in logs)
  artifacts: ArtifactStore;    // access to GHA artifacts
}

export interface PublishResult {
  status: 'published' | 'already-published' | 'skipped';
  url?: string;                // canonical URL on the registry
  bytes?: number;              // artifact size, for logs
}
```

### 7.1 Error model

Plugins throw typed errors:

- `PluginAuthError` — auth failed; do not retry.
- `PluginTransientError` — 5xx or network; core retries up to 3 times with
  exponential backoff (1s, 2s, 4s).
- `PluginFatalError` — anything else; fail the run loud.

The core treats an unthrown unknown error as fatal; plugins are expected to
annotate.

### 7.2 Built-in plugins

Three plugins ship in this repo alongside core:

- **`@pilot/pilot-crates`** — `cargo publish` + crates.io HEAD-check for
  idempotency. Reads version from Cargo.toml; supports workspace crates via
  `path` pointing at the crate dir.
- **`@pilot/pilot-pypi`** — supports `maturin`, `setuptools`, and `hatch`
  build backends. Downloads wheels from GHA artifacts (built by user's
  matrix), publishes via `twine` or `pypa/gh-action-pypi-publish` (delegated
  to a sub-action when OIDC is used). Idempotency via PyPI JSON API
  (`/pypi/{name}/{version}/json` returns 200 if published).
- **`@pilot/pilot-npm`** — `npm publish --provenance` with OIDC; idempotency
  via `npm view <pkg>@<version> version` exit code.

---

## 8. Plugin Discovery & Loading

### 8.1 Resolution order

For a package of kind `X`:

1. **Built-in registry** — if core ships a plugin for kind `X`, use it.
2. **User's repo node_modules** — `require.resolve(\`@pilot/pilot-${X}\`)` from
   the repo root.
3. **Explicit `plugin` field** in the package entry:
   ```toml
   [[package]]
   kind = "pypi"
   plugin = "@acme/pilot-pypi-custom"   # overrides built-in
   ```
4. Error if none found.

### 8.2 Installing plugins

Users install plugins into their repo:

```bash
npm i -D @pilot/pilot-pypi @pilot/pilot-crates @pilot/pilot-npm
```

Or, for zero-config users, the action auto-installs the three built-in
plugins into an ephemeral `node_modules` when it runs. `pilot.toml` can opt
out with `[pilot] auto_install_plugins = false`.

### 8.3 Plugin versioning

Each plugin is independently versioned and published to npm under `@pilot/*`.
Core declares a peer-dep range:

```json
"peerDependencies": {
  "@pilot/pilot-core": "^0.x"
}
```

Core ships a `supports(pluginApiVersion)` check; plugins built against an
older API continue to work until a major bump.

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
and hands them to plugins.

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

This surfaces misconfigurations (missing plugin, invalid trailer, tag
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
| `patch` | Same as omitted. Explicit for clarity; overrides `require_trailer`.  |
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
4. If `pilot.require_trailer = true` **and** the cascade is non-empty
   **and** no trailer is present, the `pilot-check` workflow fails on the
   PR. This is opt-in strict mode for repos that want explicit intent on
   every release.

---

## 11. Path-Filter Cascade

### 11.1 Algorithm

For each `[[package]]` in `pilot.toml`:

1. Resolve `last_tag` for this package (see §14 for tag-format resolution).
2. Compute `git diff --name-only $last_tag..HEAD`.
3. If any changed file matches any glob in `package.paths`, the package is
   **cascaded** — it will be released.

### 11.2 Glob semantics

Globs use `minimatch` with these flags: `{ dot: true, matchBase: false }`.
Double-star crosses directory boundaries. Brace-expansion enabled.

Examples:

| Glob                                | Matches                                        |
|-------------------------------------|------------------------------------------------|
| `packages/python/**/*.py`           | any `.py` under `packages/python/`             |
| `packages/python/**`                | any file under `packages/python/`              |
| `packages/{python,rust}/**`         | either subtree                                 |
| `Cargo.lock`                        | exact file at repo root                        |

### 11.3 First release

If no tag matches this package's `tag_format`, diff from the **repo root
commit** — every file in `paths` counts as "changed." The plugin uses
`first_version` (default `0.1.0`).

### 11.4 Explicit overrides

The `release:` trailer's optional `[packages, ...]` suffix allows bypassing
the path-filter cascade:

- If listed: only those packages publish, regardless of path-filter match.
- If omitted: default cascade applies.

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
and the plugin picks up files from `artifacts/<artifact_name>/`.

Plugins are documented to look at `ctx.artifacts.get(pkg.name)` which returns
an absolute path.

---

## 13. Publishing & Idempotency

### 13.1 Per-registry idempotency strategy

| Registry    | Check                                           | Write window            |
|-------------|-------------------------------------------------|-------------------------|
| crates.io   | `GET /api/v1/crates/{name}/{version}` 200 check | Permanent (yank only)   |
| PyPI        | `GET /pypi/{name}/{version}/json` 200 check     | Permanent (no unpublish)|
| npm         | `npm view {name}@{version} version` exit 0      | 72-hour unpublish window|

If `isPublished(version) === true`, the plugin returns
`{ status: 'already-published' }` and the run succeeds. This makes retries
safe and lets users re-trigger a failed workflow without consequences.

### 13.2 Retry policy

Defined in core (not per-plugin for consistency):

```
retries:        3
initial_delay:  1s
multiplier:     2
jitter:         ±25%
retry_on:       PluginTransientError, fetch 5xx, ECONNRESET, ETIMEDOUT
no_retry_on:    PluginAuthError, PluginFatalError, 4xx other than 429
```

429 is treated as transient with respect for `Retry-After`.

### 13.3 Publish order

Packages publish in parallel when safe. "Safe" = no two packages in the
cascade declare each other in their `paths`. In practice, a Python package
wrapping a Rust crate has the Rust crate's paths inside its own `paths`, so:

- If `dirsql-rust.paths` is `["packages/rust/**"]`, and
- `dirsql-python.paths` is `["packages/python/**", "packages/rust/**"]`,

a change to `packages/rust/src/lib.rs` cascades both. Pilot detects the
overlap and publishes `dirsql-rust` **first** (because its paths are a
subset of `dirsql-python`'s), then `dirsql-python`. The ordering rule: if
`A.paths ⊆ B.paths`, publish A before B.

This is the only implicit ordering in the system. If the user wants
different ordering, they structure paths accordingly.

### 13.4 Failure handling mid-cascade

If package N in a 3-package cascade fails, packages 1..N-1 stay published
(registries don't support rollback anyway). Package N+1..end are skipped.
The run exits non-zero. Re-running after fixing the issue is safe because
of §13.1 idempotency.

### 13.5 Tag creation

Tags are created **after** a successful publish, not before. Otherwise a
crashed publish leaves a tag pointing at an unpublished version.

Order within a single package's release:
1. `writeVersion()` modifies version file(s) in-memory check only during
   plan.
2. On publish: `writeVersion()` actually writes; a version-bump commit is
   made and pushed (signed if `pilot.commit_sign`).
3. `publish()` runs.
4. On success, `git tag <tag_format>` and `git push --tags`.
5. GitHub Release created via API (§15).

---

## 14. Versioning & Tags

### 14.1 Tag format

`pilot.tag_format` sets the default; each package may override. Two supported
templates:

- `v{version}` — shared tag (e.g., `v0.3.4`). Works when all packages
  release in lockstep.
- `{package}-v{version}` — per-package tag (e.g., `dirsql-python-v0.3.4`).
  Required when packages can release independently.

Interpolation tokens:
- `{version}` — semver string (e.g., `0.3.4`).
- `{package}` — `package.name` from pilot.toml.

### 14.2 Resolving `last_tag`

Given a `tag_format`, convert to a glob pattern for `git tag -l`:
- `v{version}` → `v*.*.*`
- `{package}-v{version}` → `<name>-v*.*.*` (with `name` literal)

Take the highest semver-sorted match. Use `git describe --tags --match <glob>`
fall-back for robustness.

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

Plugin-owned. Contract:
- Plugin reads the current version file.
- If version already equals target, no-op (return `[]`).
- Otherwise, update in-place and return the path list.

Examples of what each plugin edits:

| Plugin              | File(s)                                                         |
|---------------------|-----------------------------------------------------------------|
| `@pilot/pilot-crates`| `Cargo.toml` (`[package] version`), `Cargo.lock` (via `cargo update --workspace`) |
| `@pilot/pilot-pypi`  | `pyproject.toml` (`[project] version` or tool-specific)          |
| `@pilot/pilot-npm`   | `package.json` (`version`), `package-lock.json` regenerated      |

### 14.6 The version-bump commit

After plugins write version files, core creates a single commit on `main`
named `chore(release): bump <pkg1>@<v1>, <pkg2>@<v2>` with a `[skip ci]` tag
in the body to prevent recursive workflow triggers.

This commit is pushed to `main` **before** the publish step runs. If push
fails (non-fast-forward — someone else pushed to main during the window),
the run aborts before publishing.

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

### 15.2 Shared release (optional)

When `pilot.tag_format = "v{version}"` (shared tag), a single GH Release is
created per version spanning all packages. Body groups commits by package.

### 15.3 Release creation API

Uses `actions/github-script` via the core — no external action dependency.
Handled in the same `publish` job after tags push.

---

## 16. Credentials (OIDC + Tokens)

### 16.1 OIDC trusted publishing (preferred)

- **PyPI:** configure trusted publisher in PyPI project settings pointing at
  this repo + workflow file. Pilot's PyPI plugin detects OIDC availability
  (`ACTIONS_ID_TOKEN_REQUEST_TOKEN` env) and uses it. Falls back on token.
- **npm:** `npm publish --provenance` requires `id-token: write` and no
  token at all when `NODE_AUTH_TOKEN` is unset but OIDC is configured.
- **crates.io:** does **not** support OIDC as of 2026-04; always uses
  `CARGO_REGISTRY_TOKEN`.

### 16.2 Token fallback

When OIDC is unavailable or disabled:

| Registry  | Env var                 | Secret name convention      |
|-----------|-------------------------|-----------------------------|
| crates.io | `CARGO_REGISTRY_TOKEN`  | `secrets.CARGO_TOKEN`       |
| PyPI      | `PYPI_TOKEN`            | `secrets.PYPI_TOKEN`        |
| npm       | `NODE_AUTH_TOKEN`       | `secrets.NPM_TOKEN`         |

Override via `package.token_env`.

### 16.3 Log safety

All env vars matching `*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*KEY*` are
auto-masked in logs. The core's logger redacts values found in
`process.env` whose names match these patterns.

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
2. Every `[[package]]` has a resolvable plugin.
3. Every declared plugin's `validate()` passes.
4. The PR description or the tip commit has a well-formed `release:` trailer
   if `require_trailer = true`.
5. Path-filter cascade produces a non-empty set when the trailer is
   non-skip, and vice versa.
6. Computed next version for each cascaded package does not collide with an
   existing tag.
7. Plugin-specific pre-publish checks (e.g., crates.io verifies `package.name`
   is available or owned by the author via `cargo owner --list`).

### 18.3 Exit codes

- `0` — clean. Check passes.
- `1` — config or plugin error. Fix before merging.
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

## 19. Rollback Primitive

### 19.1 Scope

Registries do not support true rollback. "Rollback" in pilot means:
**republish the previous version's code under a new version number.**

### 19.2 Command

```
pilot rollback --package dirsql-python --to 0.1.45
```

### 19.3 Behavior

1. `git checkout` the tag for `dirsql-python-v0.1.45` into a temporary
   worktree.
2. Compute the next version (`0.1.46` if current is `0.1.45`, or
   `$current_patch + 1` if the current tag is higher).
3. Write that version into the plugin's version file.
4. Build from that worktree (user-provided command, same as normal build).
5. Publish via the normal plugin path.
6. Tag and release, with release notes: `Rollback to 0.1.45 code (released
   as 0.1.46)`.

### 19.4 Why not just re-tag

- crates.io and PyPI won't accept a re-publish of the same version number.
- npm's 72-hour window allows `npm unpublish` but that breaks consumers
  who've already pulled the bad version.

Publishing a new patch with the old code is the least-harmful primitive.

### 19.5 Guardrails

- `--to` must be strictly older than the current tag.
- Requires `--confirm` flag or a `ROLLBACK_CONFIRMED=1` env in CI.
- Never run automatically from the release workflow — operator-only.

---

## 20. Post-Release Verifier

### 20.1 Purpose

Catch "it published but it's broken" — a version appears on the registry
but can't be installed, imported, or initialized.

### 20.2 Mechanism

After a successful publish, each plugin may implement `smokeTest()`. The
default implementation is shell-in-container:

```
docker run --rm <base_image> sh -c "
  <install_cmd>
  <pkg.smoke>
"
```

Where `base_image` and `install_cmd` are plugin-supplied defaults:

| Plugin               | Base image          | Install command                       |
|----------------------|---------------------|---------------------------------------|
| `@pilot/pilot-crates`| `rust:slim`          | `cargo install {crate} --version {v}` |
| `@pilot/pilot-pypi`  | `python:3.12-slim`   | `pip install {pypi}=={v}`             |
| `@pilot/pilot-npm`   | `node:20-alpine`     | `npm i {name}@{v}`                    |

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
- Suggests `pilot rollback --package dirsql-python --to 0.3.4` in the log.

### 20.4 Timing

Registry CDN propagation is non-zero. The verifier retries the install up
to 3 times with 10s spacing before declaring failure.

### 20.5 Opt-out

`pilot.smoke_test = false` disables globally. Individual packages can
disable by omitting `smoke`.

---

## 21. Command Surface (`pilot` CLI)

All commands also runnable via `npx @pilot/pilot <cmd>` if not installed
globally.

### 21.1 Commands

```
pilot init                      Scaffold pilot.toml, workflows, AGENTS.md
pilot plan                      Print release plan for HEAD (dry-run by default)
pilot plan --dry-run            Explicit dry-run (no side effects)
pilot plan --json               JSON output for CI
pilot publish                   Execute the plan (CI-intended)
pilot rollback --package <p> --to <v>
                                Republish old version as next patch
pilot status                    Show last released version per package
pilot doctor                    Validate config + plugins + auth
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
| 2    | Plugin error (auth, registry 4xx)          |
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
run record — plan, computed versions, plugin outputs, timings. Useful for
debugging failed runs without re-running them.

---

## 23. Testing Strategy

### 23.1 Layers

1. **Unit tests (vitest)** — cover every pure function: trailer parser,
   version bumper, cascade calculator, tag resolver, glob matcher, retry
   policy. Target: 100% coverage for `pilot-core/src/` excluding plugin
   adapters.

2. **Plugin contract tests** — each plugin must pass a shared test suite
   (`@pilot/pilot-plugin-testkit`) that asserts the interface contract
   independent of the real registry.

3. **Integration tests (mocked registries)** — spin up `verdaccio`
   (for npm), `pypiserver` (for PyPI), and stub crates.io HTTP with
   `msw`. Full publish cycles end-to-end, verifying idempotency, retry,
   and tag creation.

4. **Workflow tests (`act`)** — run the GHA action locally via `act` on
   fixture repos. Catches action.yml misconfig and wrapper bugs.

5. **Smoke scenarios** — the `examples/` directory holds reference
   monorepos (rust+python+ts, rust-only, python-only, npm-only). CI runs
   the full workflow on each.

### 23.2 TDD for release logic

The release semantics (trailer parsing, cascade, version bumps, tag
ordering) are the most error-prone parts. These must be TDD'd:
**red → green → refactor**, tests written first in every PR that changes
this logic. The CI runs a strict lint: core PRs without a test file in the
diff fail the build.

### 23.3 Golden tests for CLI output

`pilot plan --json` output is snapshot-tested against golden files in
`test/golden/`. This catches accidental changes in the matrix contract
(which would break user workflow YAMLs).

### 23.4 Publish on real registries (gated)

A separate workflow (`.github/workflows/real-publish-test.yml`) runs
weekly against real registries using a canary package (`@pilot-canary/*`).
Verifies OIDC remains configured correctly after any registry policy
change.

---

## 24. Distribution

### 24.1 npm packages

All published under the `@pilot/` scope:

| Package                      | Purpose                                    |
|------------------------------|--------------------------------------------|
| `@pilot/pilot-core`          | Shared core; plugin API                    |
| `@pilot/pilot` (CLI)         | Binary entry; `pilot` command              |
| `@pilot/pilot-crates`        | Built-in Rust plugin                       |
| `@pilot/pilot-pypi`          | Built-in Python plugin                     |
| `@pilot/pilot-npm`           | Built-in npm plugin                        |
| `@pilot/pilot-plugin-testkit`| Test harness for plugin authors            |

### 24.2 The action

Published as `thekevinscott/put-it-out-there@v0` — GitHub consumes from the
repo directly. Bundled with `@vercel/ncc` into `dist/index.js` + `action.yml`.
A release workflow on this repo tags `v0`, `v0.1.x`, etc.

### 24.3 Global install

```
npm i -g @pilot/pilot
```

Or `npx @pilot/pilot <cmd>` for one-off use.

### 24.4 First-run for new users

```
cd my-monorepo
npx @pilot/pilot init
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
- [x] Path-filter cascade
- [x] Three built-in plugins (crates, pypi, npm)
- [x] Plugin loader (built-in + user-installed)
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

- [ ] `pilot rollback` — design locked (§19), implementation deferred to v0.1.
- [ ] Post-release smoke tests — design locked (§20), deferred.
- [ ] `pilot changelog` — not designed.
- [ ] Non-Claude agent variants for `pilot init`.
- [ ] Private registry support.
- [ ] Pre-release dist-tags (rc, beta, alpha).
- [ ] Hotfix branches.
- [ ] `pilot status` dashboard.

### 25.3 Success criteria

v0 is "done" when:

1. The pilot repo itself uses pilot for its releases (dogfooding).
2. The dirsql monorepo (user's canonical use case) releases cleanly via
   pilot, replacing whatever ad-hoc script it has today.
3. Full publish cycle runs in under 5 minutes on the reference repo.
4. Adding a new plugin (e.g., `@pilot/pilot-ruby`) takes under a day for
   someone familiar with Ruby gem publishing.
5. README walkthrough is reproducible by someone who has never seen pilot
   in under 30 minutes.

---

## 26. v0.1+ Roadmap

Ordered roughly by likely-value, not commitment. Items move into v0.2, v0.3
etc. based on dogfooding outcomes.

### 26.1 v0.1 (quick follow-ups)

- `pilot rollback` implementation.
- Post-release smoke tests (§20).
- `pilot changelog` — generate markdown release notes from PR titles and
  bodies since last tag.
- `pilot init --agent=cursor`, `--agent=copilot` variants.

### 26.2 v0.2

- Pre-release dist-tags (`-rc.N`, `-beta.N`, `-alpha.N`) with dedicated
  bump command: `release: prerelease`.
- `pilot status` — dashboard command showing last-released version,
  pending cascade, outstanding failures.
- Plugin auto-update check (warn if installed plugin is behind latest).

### 26.3 v0.3+

- Private registry support (self-hosted crates registry, private PyPI,
  GitHub Packages for npm).
- Hotfix branches with back-port tooling.
- Scheduled/batched release mode (opposite of v0's immediate mode).
- Additional built-in plugins: Ruby gems, Go modules (if/when Go moves
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
version        = 1
default_branch = "main"
tag_format     = "{package}-v{version}"
require_trailer = false
agents_path    = "pilot/AGENTS.md"

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
auth          = "token"
token_env     = "CARGO_REGISTRY_TOKEN"

[[package]]
name          = "dirsql-python"
kind          = "pypi"
path          = "packages/python"
pypi          = "dirsql"
paths         = [
  "packages/python/**",
  "packages/rust/**",                # PyO3 wrapper — Rust changes cascade
]
build         = "maturin"
auth          = "oidc"
first_version = "0.1.0"
smoke         = "python -c 'import dirsql; dirsql.DirSQL'"

[[package]]
name          = "dirsql-cli"
kind          = "npm"
path          = "packages/ts"
npm           = "dirsql-cli"
paths         = ["packages/ts/**"]
auth          = "oidc"
access        = "public"
first_version = "0.1.0"
smoke         = "dirsql --version"
```

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
