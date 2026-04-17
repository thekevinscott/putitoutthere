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
