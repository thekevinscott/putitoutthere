---
name: first-release
description: >-
  Interactive, repo-aware walkthrough for a first release with putitoutthere.
  Detects what the repo publishes, writes putitoutthere.toml and the release
  workflows, validates at PR time, previews exactly what will publish, walks
  trusted-publisher registration and the first-publish token bootstrap per
  registry (crates.io, PyPI, npm), drives the first release push, and diagnoses
  failures. Use when the user says "walk me through the first release", "set up
  my first release", "onboard to putitoutthere", "help me publish for the first
  time", or is configuring putitoutthere from scratch.
---

# Walk me through the first release

You are guiding someone through their **first** release with putitoutthere —
a reusable GitHub Actions workflow that publishes to crates.io, PyPI, and npm.
The first release is the fraught moment: config that doesn't match the
manifests, trusted publishers that aren't registered, the first-publish token
bootstrap, and a toolchain getting exercised end to end for the first time.
Your job is to surface every one of those *before* the release runs, so the
release itself is boring.

This skill bundles the canonical templates and two references beside this file,
so it works whether it lives in the putitoutthere repo or is copied into a
consumer's repo. The authoritative source is always the putitoutthere README
and `src/error-codes.ts`; if a detail here looks stale, check there.

## How to run this

- **Go one step at a time.** Do a step, show the result, confirm, move on.
  Don't dump the whole plan and walk away.
- **Be repo-aware, not generic.** Read the actual manifests and write config
  that matches them. Never invent package names, paths, or targets you didn't
  observe or confirm with the user.
- **Verify from authoritative state; never infer.** This is the lesson both
  recorded first-release sessions paid for. Before any irreversible step, and
  before claiming any step succeeded, check the real source — `plan` output, a
  CI run's actual conclusion, the registry API, the git tags — not a guess from
  adjacent evidence. "It's probably green" / "the version's already published
  so it's a no-op" is exactly where it goes wrong.
- **Confirm before outward or hard-to-undo actions** — opening a PR, merging to
  `main` (that is the publish trigger), anything that hits a registry,
  publishing a package name (names are permanent). Generating local files is
  fine to do and then show.
- **Never touch secrets.** Tokens go into GitHub repository secrets by the
  *user*, in the GitHub UI. Never ask for a token in chat, never write one to a
  file, never echo one.
- **Prefer defaults.** putitoutthere's whole design is "as little config as
  possible." Only set a field when the detected reality requires it.
- **Stay in scope.** This skill sets up a release; it is not a place to add
  build hooks, custom steps, or per-check inputs. If the repo doesn't fit a
  named build mode, say so — that repo writes its own workflow.

Use `AskUserQuestion` at the decision points called out below rather than
guessing.

## Operating principle: no release surprises

putitoutthere catches what it can as early as it can. Mirror that:

1. Get the config and manifests into agreement **locally**.
2. Validate them **at PR time** with `check.yml` (and `build.yml`) — green
   there means "a release from this commit would not surface
   configuration-level surprises."
3. **Preview exactly what will publish** with `plan` / the `build-check.yml`
   run, and confirm it.
4. Only then register publishers and push the release.

Do not jump straight to a release-on-`main`. The PR validation gate and the
plan preview are the point.

---

## Step 0 — Orient

1. Confirm you're in the repo that will publish (not putitoutthere itself,
   unless they're dogfooding). Note the GitHub `owner/repo` — you'll need it
   for trusted publishers and URL matching.
2. **Confirm the repo is public.** putitoutthere refuses to publish from a
   private repo (`PIOT_REPO_PRIVATE`) — npm provenance attestations embed a
   source pointer consumers can't dereference when the repo is private. If it's
   private, stop and surface that before doing anything else.
3. Read any existing `putitoutthere.toml`, `.github/workflows/release.yml`,
   `check.yml`, `build-check.yml`. If setup is partly done, adapt — don't
   clobber. Show the user what already exists before changing it. Track what's
   already done so you don't re-ask or redo it.
4. Note two things that bite mid-flight: the reusable workflow is pinned at
   `@v0`, a **moving tag** whose behavior can shift between runs; and if this
   repo was recently **transferred or renamed**, manifest URLs and trusted
   publishers may still point at the old owner (see Step 2 and Step 6).
5. Ask what they want to publish if it isn't obvious from the tree.

## Step 1 — Detect what this repo publishes

Inspect the tree and map manifests to package kinds:

- `Cargo.toml` with `[package]` → a `crates` candidate (path = its dir).
- `pyproject.toml` → a `pypi` candidate. Read `[build-system].build-backend`
  to infer `build` (`maturin` / `hatchling.build` → `hatch` /
  `setuptools.build_meta` → `setuptools`).
- `package.json` → an `npm` candidate. Note a scoped `name` (`@scope/x`).

Decide **single-package vs. polyglot/multi**:

- One manifest → one `[[package]]`.
- A Rust crate wrapped by a wheel and/or npm package → a cascade: the crate is
  the root, the wrappers `depends_on` it. Confirm the dependency direction.
- Several independent packages → one `[[package]]` each, `depends_on` only
  where one genuinely builds on another.

Summarize what you found and have the user confirm before writing config.

## Step 2 — Write `putitoutthere.toml`

Start from `templates/putitoutthere.toml` (beside this file) and fill it from
what you detected. Keep it minimal. Per package set `name`, `kind`, `path`,
`globs`; add `tag_format` (single-package repos usually want `"v{version}"`),
`build` / `targets` (required for maturin / napi / bundled-cli), and
`depends_on` (real build deps only) when needed.

**Names are permanent — get them right now.** A crates.io or npm name, once
published, is effectively yours forever; there is no clean rename or reclaim.
Watch for scaffold/template leftovers (a stray `-cli` suffix, the template's
own name) that would otherwise ship for good. Confirm every name is the final
intended one with the user — this is a "confirm before irreversible" gate.

**Avoid the four schema gotchas:** `[putitoutthere]` table with `version = 1`
inside (not at root); `[[package]]` singular (not `[[packages]]`);
`kind = "crates"` (not `registry =`); `globs =` (not `files =`).

**Make the manifests agree with the config now** — preflight rejects these at
PR time and again before any publish side effect, so fix them while you're
here. The authoritative code list is `src/error-codes.ts`; the ones that bite a
first release:

- **Repo URL match** — each manifest's repository URL must resolve to *this*
  `owner/repo` (`PIOT_REPO_URL_MISMATCH`): `package.json#repository`,
  `Cargo.toml [package].repository`, `pyproject.toml [project.urls]`. The
  classic cause is a repo transfer/rename leaving the old owner in the
  manifests.
- **npm**: non-empty `repository` field (`PIOT_NPM_MISSING_REPOSITORY`); `name`
  equals the package name or `npm` override (`PIOT_NPM_NAME_MISMATCH`).
- **crates**: `[package].name` matches (or `crate` override); `description` +
  `license`/`license-file` set (`PIOT_CRATES_MISSING_METADATA`); features
  declared; `[[bin]]` present when `bundle_cli.bin` is set; the packaged
  `.crate` stays under crates.io's 10 MiB limit (`PIOT_CRATES_PACKAGE_TOO_LARGE`
  — a tracked symlink into a build dir is the usual culprit).
- **pypi**: `dynamic = ["version"]` (a static `version = "..."` is rejected,
  `PIOT_PYPI_STATIC_VERSION`, because putitoutthere never edits
  `pyproject.toml`). Blessed shape is `hatch-vcs`; `setuptools-scm` and maturin
  (version from the sibling `Cargo.toml`) are also accepted. `[project].name`
  matches (or `pypi` override).

Write the file, show it, confirm.

## Step 3 — Drop in the workflows

Copy from `templates/` beside this file:

- **`.github/workflows/release.yml`** — required. Keep the `pypi-publish` job
  **verbatim even if you don't publish to PyPI** (its `if:` gate self-skips).
  It must run in the caller's context; PyPI TP can't validate a token minted
  inside the reusable workflow.
- **`.github/workflows/check.yml`** — recommended. Every pre-merge config check
  in seconds on each PR. Your fast surprise-catcher.
- **`.github/workflows/build-check.yml`** — recommended, and load-bearing for
  Step 5: it runs the *real plan + build matrix* with the publish job
  structurally absent, so it both compiles every per-target artifact and gives
  you a publish-free preview of what would release.

Keep all `@v0` refs and filenames exactly — TP records encode the `release.yml`
filename; renaming it later silently breaks trust.

**Warn loudly:** `release.yml` should be the **only** workflow triggered on
`push: branches: [main]`. Move any per-language CI (`rust.yml`, `node.yml`, …)
to `pull_request:` only — duplicate `push: main` runs contend for runners and
delay the release.

## Step 4 — Validate at PR time

Open a PR with the config + workflows (confirm before opening). Let `check.yml`
and `build-check.yml` run and go **green** before anything releases:

- `check.yml` green = config and manifests agree; no config-level surprise.
- `build-check.yml` green = every per-target wheel/binary actually builds.

If anything is red, fix it here — that is the whole point of catching it at PR
time instead of at release. Don't proceed on red.

## Step 5 — Preview exactly what will publish, and confirm

The most expensive recorded first-release mistake was asserting a merge's
release effect without checking — and being wrong. **Never assert what a merge
will publish. Read it from an authoritative dry-run, then confirm with the
user.** See `reference/plan-and-recovery.md` for the full mechanics; the core:

- Run **`npx putitoutthere plan`** (or read the **`build-check.yml` run on the
  PR** — same planner, no publish job). `plan` prints the exact
  `{package → version}` set the merge would produce, a per-package `PUBLISH` /
  `SKIP` verdict, and a **⚠ version-skew** warning if a dependent would publish
  while a dependency it `depends_on` is skipped — the up-front catch for the
  worst cascade failure.
- Sanity-check it against how the planner decides: on the **very first release
  (no tags yet) every declared package ships at its `first_version`** — globs
  do not gate run one, so expect *everything* to publish. On later releases a
  package is planned only if files matching *its own* globs changed since *its
  own* last tag (plus `depends_on` and `release:` trailer). Default bump is
  `patch`.
- State the predicted plan back — "this publishes my-rust 0.1.0 and my-py
  0.1.0" — and get explicit confirmation before merging. Reason from globs and
  tags, **never** from "is the version already published."

## Step 6 — Register trusted publishers + first-publish bootstrap

Read `reference/trusted-publishers.md` beside this file and follow the section
for each registry. The short of it:

- **PyPI** — register a *pending* publisher. **No token needed.** Cleanest.
- **crates.io** — TP binds to an existing crate, so the first publish needs a
  one-time `CARGO_REGISTRY_TOKEN` secret (or a local `cargo publish`).
- **npm** — TP binds to an existing package, so the first publish needs a
  one-time `NPM_TOKEN` secret. For `bundled-cli` / `napi` families, that one
  token covers every per-platform sub-package's first publish.

Walk the user to the registry web UI and the GitHub **secrets** UI; have *them*
paste any token. Register every TP against **their** repo + `release.yml` (not
against putitoutthere), with the correct *current* owner if the repo was
transferred. For npm families, every per-platform sub-package needs its own TP.
If a bootstrap secret is needed for this first run, add the matching `secrets:`
block to the `release` job at the call site (examples in the reference). It
comes back out in Step 9.

## Step 7 — Push the first release

When the PR is green, the plan is confirmed, and publishers are registered
(pending publishers count for PyPI), merge to `main` — **this is the
irreversible publish trigger; confirm intent first.** Put any non-default bump
trailer where your merge strategy surfaces it (squash → the one commit; merge
commit → the branch tip): `release: minor` etc.

Watch the `Release` run. The reusable workflow plans → builds → preflights →
publishes in dependency order, then creates a GitHub Release per tag.

**Set expectations:** a first release exercises the whole toolchain for the
first time and may surface a *cascade* of issues, each masking the next. That
is normal. Don't declare success from a glance — confirm from the run's actual
conclusion, the registries, and the tags (Step 10).

## Step 8 — If a run fails: diagnose, fix, re-run

First-release failures are almost always real, not flakes. Work them per
`reference/plan-and-recovery.md`:

- **Grep the run log for the `PIOT_*` code** and look it up in
  `src/error-codes.ts` (the README table is a subset). Each code names the
  mechanism and the fix.
- **Re-running is safe** — every handler's first publish move is an
  `isPublished` check, so re-runs skip already-published versions cleanly.
- **Published-but-untagged drift self-heals.** If a run published a version but
  died before (or lacked permission to) push the tag, the package would
  otherwise stick — the planner reads "last released" from tags, so it looks
  unreleased forever. The publish path now writes the missing tag on the next
  release run automatically, and **`npx putitoutthere reconcile`** backfills it
  on demand with no release (it creates the tag at the sibling packages'
  release commit). `status` (Step 10) flags this as `published, untagged`.
- **The PyPI partial-tag trap is the *opposite* drift and still needs a manual
  recovery.** The engine tags a pypi package in its publish job, but the
  *upload* runs in your caller-side `pypi-publish` job afterward. If that upload
  fails, the **tag exists but PyPI is empty** — `status` shows
  `tagged, unpublished` — and the next run excludes the now-tagged package from
  the plan (`has_pypi=false`) → stuck. `reconcile` does **not** fix this (the
  tag is already there; the *publish* is what's missing). Recover with the
  **`release_packages` override at a bumped version** (`my-py@0.0.2`) — the
  clean path, and the general tool for re-releasing after any pipeline fix.
- **Scoped-env limits:** git access may be branch-scoped (`403` on tag pushes
  or other branches). `reconcile` belongs in CI with the release job's
  permissions; from a scoped agent, route tag backfills to the user or sidestep
  with the `release_packages` bump. Don't claim a fix landed via a path the
  environment blocks.

## Step 9 — Reach the secure steady state

After the first publish succeeds and the packages exist on the registries:

1. Register the real trusted publishers against the now-existing crate / npm
   package(s) if you bootstrapped with a token (PyPI's pending publisher
   already converted itself).
2. **Confirm OIDC is actually active before deleting anything.** Run
   **`npx putitoutthere verify`**: per package it reports `oidc` (a
   trusted-publisher / provenance attestation is present — safe to drop the
   token) or `token` (still token-dependent). Don't remove a secret until the
   package reads `oidc`.
3. **Remove the `secrets:` block** from `release.yml` and **delete the
   bootstrap secrets** (`CARGO_REGISTRY_TOKEN`, `NPM_TOKEN`). Subsequent
   publishes are then zero-secret OIDC — the secure default.
4. For npm `bundled-cli` / `napi` families, each per-platform sub-package
   (`@scope/cli-linux-x64-gnu`, …) needs its own TP. `verify` reports the
   configured (main) package's posture, so confirm the sub-packages in the npm
   UI. `verify --check` exits non-zero while the configured package is still
   token-dependent — a one-line CI gate for the steady state.

## Step 10 — Verify from authoritative sources

Confirm the release actually landed — by checking, not assuming. **`status`
collapses the tag-vs-registry cross-check into one command:**

- Run **`npx putitoutthere status --check`** (fetch tags first —
  `git fetch --tags`). It reconciles every package's latest git tag against the
  registry's latest published version and flags drift: `published, untagged`
  (the tag push failed → `reconcile` it, Step 8), `tagged, unpublished` (the
  **partial-tag trap** — tag exists, registry doesn't have it → re-release,
  Step 8), or `version mismatch`. `--check` exits non-zero on any drift, so it
  also works as a CI gate. **`in sync` on every package is the green light.**
- Run **`npx putitoutthere verify`** to confirm trust posture — `oidc` means
  the release authenticated via a trusted publisher, no token in the loop.
- A **GitHub Release** was created for each tag.
- (Recommended) A no-op change to `main` does **not** trigger a publish, and a
  real change publishes via OIDC with no secret present.

When `status` shows every package `in sync` and `verify` shows `oidc`, the
first release is done and the repo is in the zero-secret steady state.

---

## Guardrails

- **Verify, don't assume, for anything irreversible or outward** — publish
  state, "it's green," signatures, what a merge will release. Read the
  authoritative source.
- **Never infer a "no-op" from "the version is already published."** Releases
  are decided by globs-since-last-tag, not registry state. Use `plan` /
  build-check.
- **Names and first publishes are permanent.** Confirm every registered name
  before the first publish.
- **Secrets never appear in chat, files, or commits.** The user pastes tokens
  into the GitHub secrets UI; you never see or store them.
- **Confirm before:** opening a PR, merging to `main`, anything that publishes.
- **Never propose merging on red CI**, skipping a failing check, or relaxing
  all-or-nothing publishing to "ship the parts that worked."
- **Don't expand scope.** No build hooks, no custom `steps:`, no per-check
  inputs. A repo that doesn't fit a named build mode writes its own workflow.
- **Don't rename `release.yml`** (or any release-path workflow) once a TP
  record points at it.
