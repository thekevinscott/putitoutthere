# Put It Out There — Comprehensive Plan

> **Status:** v0 design doc. Locked decisions below are locked for v0; the
> roadmap sections call out what is deliberately deferred.
>
> **Repo:** https://github.com/thekevinscott/put-it-out-there
> **CLI:** `pilot`
> **npm scope:** `@piot/`
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
│     @piot/pilot-core  ◄── reads pilot.toml             │
│       │                                                 │
│       ├─► @piot/pilot-crates  (Rust → crates.io)       │
│       ├─► @piot/pilot-pypi    (Python → PyPI)          │
│       └─► @piot/pilot-npm     (TS/JS → npm)            │
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

### 2.2 Why a git trailer

- **Locatable:** `git log --format=%B -1 $COMMIT` yields it cleanly; no parsing
  of prose required.
- **Machine-writable:** Claude can be instructed to append a trailer deterministically.
- **GitHub-preserved:** squash-merge concatenates commit bodies; the trailer
  survives on the merge commit.
- **Opt-in:** absence of the trailer means "no release," which is the safe
  default for docs-only or infra commits.

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
- **Monorepo tooling it doesn't own.** Nx, Turborepo, Pants, Bazel integration
  is out of scope. Pilot reads `pilot.toml` and does the release; the user's
  build system does the build.

---

## 4. Glossary

| Term              | Meaning                                                                                       |
|-------------------|-----------------------------------------------------------------------------------------------|
| **Package**       | One row in `[[package]]` — a publishable unit (one crate, one wheel-set, one npm package).    |
| **Plugin**        | An npm module implementing the plugin interface for one registry (`@piot/pilot-crates`, etc).  |
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
│   ├── core/                             ← @piot/pilot-core
│   │   ├── config.ts                     ← pilot.toml loader + schema
│   │   ├── cascade.ts                    ← path-filter → package set
│   │   ├── trailer.ts                    ← parse `release:` from merge commit
│   │   ├── version.ts                    ← bump logic, tag formatting
│   │   ├── plugin.ts                     ← plugin interface + loader
│   │   ├── registry.ts                   ← built-in plugin registry
│   │   ├── git.ts                        ← git wrapper (tag, log, trailer)
│   │   ├── state.ts                      ← read last-published tags
│   │   └── run.ts                        ← top-level orchestration
│   └── cli/                              ← @piot/pilot
│       └── bin.ts                        ← yargs/commander entry
└── plugins/
    ├── crates/                           ← @piot/pilot-crates
    ├── pypi/                             ← @piot/pilot-pypi
    └── npm/                              ← @piot/pilot-npm
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
users install globally (`npm i -g @piot/pilot`) or via `npx @piot/pilot`. The
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
require_trailer  = true                      # fail if merge commit lacks `release:`
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

- **`@piot/pilot-crates`**: `crate` (crates.io name if differs), `features`,
  `target` (publishing target triple list).
- **`@piot/pilot-pypi`**: `pypi`, `build` (`maturin` \| `setuptools` \| `hatch`),
  `wheels_artifact` (artifact name to download from build matrix).
- **`@piot/pilot-npm`**: `npm` (package name if differs), `access`
  (`public` \| `restricted`), `tag` (dist-tag, default `latest`).

---

## 7. Plugin Interface

All plugins implement a single default-exported object conforming to this TS
interface (shipped from `@piot/pilot-core/types`):

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

- **`@piot/pilot-crates`** — `cargo publish` + crates.io HEAD-check for
  idempotency. Reads version from Cargo.toml; supports workspace crates via
  `path` pointing at the crate dir.
- **`@piot/pilot-pypi`** — supports `maturin`, `setuptools`, and `hatch`
  build backends. Downloads wheels from GHA artifacts (built by user's
  matrix), publishes via `twine` or `pypa/gh-action-pypi-publish` (delegated
  to a sub-action when OIDC is used). Idempotency via PyPI JSON API
  (`/pypi/{name}/{version}/json` returns 200 if published).
- **`@piot/pilot-npm`** — `npm publish --provenance` with OIDC; idempotency
  via `npm view <pkg>@<version> version` exit code.

---

## 8. Plugin Discovery & Loading

### 8.1 Resolution order

For a package of kind `X`:

1. **Built-in registry** — if core ships a plugin for kind `X`, use it.
2. **User's repo node_modules** — `require.resolve(\`@piot/pilot-${X}\`)` from
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
npm i -D @piot/pilot-pypi @piot/pilot-crates @piot/pilot-npm
```

Or, for zero-config users, the action auto-installs the three built-in
plugins into an ephemeral `node_modules` when it runs. `pilot.toml` can opt
out with `[pilot] auto_install_plugins = false`.

### 8.3 Plugin versioning

Each plugin is independently versioned and published to npm under `@piot/*`.
Core declares a peer-dep range:

```json
"peerDependencies": {
  "@piot/pilot-core": "^0.x"
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

## 10. Release Trailer Convention

### 10.1 Syntax

The trailer lives in the merge commit body (GitHub preserves commit bodies
on squash-merge when the PR description contains them, or the user writes
them directly). Format follows Git's existing trailer conventions (RFC
822-style key/value lines at the end of the commit message):

```
Add streaming reader API

Adds a chunked reader to dirsql that yields rows lazily instead
of buffering the full result set.

release: minor
```

### 10.2 Grammar

```
trailer     = "release:" WS ( "patch" | "minor" | "major" | "skip" ) [ WS packages ]
packages    = "[" package-list "]"
package-list = package-name *( "," WS package-name )
```

### 10.3 Examples

```
release: patch
```
Bumps every package whose `paths` intersect the changed files.

```
release: minor [dirsql-python, dirsql-rust]
```
Bumps only the listed packages at minor; other cascaded packages are NOT
released (explicit override).

```
release: skip
```
Force no release, even if files changed in a package's `paths`. Useful for
docs-only changes mixed with a code commit.

(absence of trailer)
- If `pilot.require_trailer = true`, the `pilot-check` workflow fails on PRs
  that would cascade to any package. Otherwise the commit is no-op.

### 10.4 Parsing

The trailer parser uses `git interpret-trailers` when available, with a
pure-TS fallback (`parse-trailers`). Case-insensitive key match. Only the
**last** `release:` line in the commit wins, consistent with `git trailer`
semantics.

### 10.5 Precedence

When `workflow_dispatch` is triggered manually:

1. Manual `packages` + `bump` inputs are **authoritative** — they override
   any trailer.
2. If no manual inputs are provided but the event is `workflow_dispatch`,
   behave as if the tip of `main` had `release: patch`.
3. On `push` events, the trailer on the HEAD commit of `main` is canonical.
4. If the HEAD commit lacks a trailer and the user opts into
   `require_trailer`, the run fails with a clear message including the
   commit SHA.

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
