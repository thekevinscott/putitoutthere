---
name: first-release
description: >-
  Interactive, repo-aware walkthrough for a first release with putitoutthere.
  Detects what the repo publishes, writes putitoutthere.toml and the release
  workflows, walks trusted-publisher registration and the first-publish token
  bootstrap per registry (crates.io, PyPI, npm), then drives the first release
  push and verifies it. Use when the user says "walk me through the first
  release", "set up my first release", "onboard to putitoutthere", "help me
  publish for the first time", or is configuring putitoutthere from scratch.
---

# Walk me through the first release

You are guiding someone through their **first** release with putitoutthere —
a reusable GitHub Actions workflow that publishes to crates.io, PyPI, and npm.
The first release is the fraught moment: config that doesn't match the
manifests, trusted publishers that aren't registered, the first-publish
token bootstrap. Your job is to surface every one of those *before* the
release runs, so the release itself is boring.

This skill bundles the canonical templates and a trusted-publisher reference
beside this file, so it works whether it lives in the putitoutthere repo or is
copied into a consumer's repo. The authoritative source is always the
putitoutthere README; if a detail here looks stale, check there.

## How to run this

- **Go one step at a time.** Do a step, show the result, confirm, move on.
  Don't dump the whole plan and walk away.
- **Be repo-aware, not generic.** Read the actual manifests and write config
  that matches them. Never invent package names, paths, or targets you didn't
  observe or confirm with the user.
- **Confirm before outward or hard-to-undo actions** — opening a PR, pushing
  to `main`, anything that hits a registry. Generating local files is fine to
  do and then show.
- **Never touch secrets.** Tokens go into GitHub repository secrets by the
  *user*, in the GitHub UI. Never ask for a token in chat, never write one to
  a file, never echo one.
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
3. Only then register publishers and push the release.

Do not jump straight to a release-on-`main`. The PR validation gate is the
point.

---

## Step 0 — Orient

1. Confirm you're in the repo that will publish (not putitoutthere itself,
   unless they're dogfooding). Note the GitHub `owner/repo` — you'll need it
   for trusted publishers.
2. Read any existing `putitoutthere.toml`, `.github/workflows/release.yml`,
   `check.yml`, `build.yml`. If setup is partly done, adapt — don't clobber.
   Show the user what already exists before changing it.
3. Ask what they want to publish if it isn't obvious from the tree.

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
  the root, the wrappers `depends_on` it. Confirm the dependency direction
  with the user.
- Several independent packages → one `[[package]]` each, `depends_on` only
  where one genuinely builds on another.

Summarize what you found and have the user confirm before writing config.

## Step 2 — Write `putitoutthere.toml`

Start from `templates/putitoutthere.toml` (beside this file) and fill it from
what you detected. Keep it minimal. Per package set `name`, `kind`, `path`,
`globs`; add the rest only when needed:

- **`tag_format`** — single-package repos usually want `"v{version}"` (default
  is `"{name}-v{version}"`). Ask which they prefer.
- **`globs`** — the paths whose changes should cascade a release. For a
  wrapper that rebuilds when the core changes, include the core's path too
  (e.g. the npm package's globs include `crates/my-core/**`).
- **`build` / `targets`** — required for `maturin` (pypi) and for
  `napi` / `bundled-cli` (npm). List the platform triples they ship.
- **`depends_on`** — only real build dependencies.

**Avoid the four schema gotchas** (the engine hints on these, but don't trip
them): `[putitoutthere]` table with `version = 1` inside (not at root);
`[[package]]` singular (not `[[packages]]`); `kind = "crates"` (not
`registry =`); `globs =` (not `files =`).

**Make the manifests agree with the config now** — preflight rejects these at
PR time and again before any publish, so fix them while you're here:

- **npm**: `package.json` needs a non-empty `repository` field
  (`PIOT_NPM_MISSING_REPOSITORY`) and its `name` must equal the package name
  or the `npm` override (`PIOT_NPM_NAME_MISMATCH`).
- **crates**: `Cargo.toml` `[package].name` must match (or `crate` override);
  `description` and `license` (or `license-file`) must be set
  (`PIOT_CRATES_*`).
- **pypi**: `pyproject.toml` must declare `dynamic = ["version"]` — a static
  `version = "..."` is rejected (`PIOT_PYPI_STATIC_VERSION`) because
  putitoutthere never edits `pyproject.toml`. The blessed shape is `hatch-vcs`
  (`[tool.hatch.version] source = "vcs"`); `setuptools-scm` and maturin
  (version from the sibling `Cargo.toml`) are also accepted. `[project].name`
  must match (or `pypi` override).

Write the file, show it, confirm.

## Step 3 — Drop in the workflows

Copy from `templates/` beside this file:

- **`.github/workflows/release.yml`** — required. Keep the `pypi-publish` job
  **verbatim even if you don't publish to PyPI** (its `if:` gate self-skips).
  It must run in the caller's context; PyPI TP can't validate a token minted
  inside the reusable workflow.
- **`.github/workflows/check.yml`** — recommended. Runs every pre-merge config
  check in seconds on each PR. This is your fast surprise-catcher.
- **`.github/workflows/build-check.yml`** — recommended. Runs the real
  plan+build matrix on each PR (compiles every per-target wheel/binary) to
  catch what `check.yml` can't.

Keep all `@v0` refs and filenames exactly — TP records encode the `release.yml`
filename; renaming it later silently breaks trust.

**Warn loudly:** `release.yml` should be the **only** workflow triggered on
`push: branches: [main]`. If they have per-language CI (`rust.yml`, `node.yml`,
…), move it to `pull_request:` only. Duplicate `push: main` runs contend for
runners and delay the release.

## Step 4 — Validate at PR time (the gate that matters)

Open a PR with the config + workflows (confirm before opening). Let `check.yml`
and `build-check.yml` run and go **green** before any release:

- `check.yml` green = config and manifests agree; no config-level surprise.
- `build-check.yml` green = every per-target wheel/binary actually builds.

If anything is red, fix it here — that's the whole point of catching it at PR
time instead of at release. Don't proceed to a release on red.

## Step 5 — Register trusted publishers + first-publish bootstrap

This is the trickiest part. Read `reference/trusted-publishers.md` beside this
file and follow the section for each registry you publish to. The short of it:

- **PyPI** — register a *pending* publisher. **No token needed.** Cleanest
  path.
- **crates.io** — TP binds to an existing crate, so the first publish needs a
  one-time `CARGO_REGISTRY_TOKEN` secret (or a local `cargo publish`).
- **npm** — TP binds to an existing package, so the first publish needs a
  one-time `NPM_TOKEN` secret. For `bundled-cli` / `napi` families, that one
  token covers every per-platform sub-package's first publish.

Walk the user to the registry web UI and the GitHub **secrets** UI; have *them*
paste any token. Register every TP against **their** repo + `release.yml` (not
against putitoutthere). For npm families, every per-platform sub-package needs
its own TP.

If a bootstrap secret is needed for this first run, add the matching `secrets:`
block to the `release` job at the call site (examples in the reference). It
comes back out in Step 7.

## Step 6 — Push the first release

When the PR is green and publishers are registered (pending publishers count
for PyPI), merge to `main`. Default behavior: any package whose `globs` matched
the changed files cascades and ships at `patch`. To bump differently, put a
trailer in the merge commit body:

```
release: minor
```

(`patch` | `minor` | `major` | `skip`; optional `[pkg, …]` scope; last trailer
wins.) For a first release the default `patch` off `first_version` is usually
fine — confirm the intended version with the user.

Watch the `Release` run. The reusable workflow plans → builds → preflights →
publishes in dependency order, and creates a GitHub Release per tag with
auto-generated notes. If it fails, read the `PIOT_*` code in the run log and
look it up in the README's error-code table before retrying — re-running is
safe (each handler's first move is an `isPublished` check that skips
already-published versions cleanly).

## Step 7 — Reach the secure steady state

After the first publish succeeds and the packages exist on the registries:

1. Register the real trusted publishers against the now-existing crate / npm
   package(s) if you bootstrapped with a token (PyPI's pending publisher
   already converted itself).
2. **Remove the `secrets:` block** from `release.yml` and **delete the
   bootstrap secrets** (`CARGO_REGISTRY_TOKEN`, `NPM_TOKEN`). Subsequent
   publishes are then zero-secret OIDC — the secure default.
3. For npm families, confirm a TP exists for **every** per-platform
   sub-package, not just the top-level.

## Step 8 — Verify

Confirm the release actually landed:

- The version is live on the registry (crates.io / PyPI / npmjs.com).
- The git tag exists (`{name}-v{version}` or your `tag_format`).
- A GitHub Release was created for the tag with generated notes.
- (Recommended) The next no-op change to `main` does **not** trigger a publish,
  and a real change publishes via OIDC with no secret present.

When all of that holds, the first release is done and the repo is in the
zero-secret steady state.

---

## Guardrails

- **Secrets never appear in chat, files, or commits.** The user pastes tokens
  into the GitHub secrets UI; you never see or store them.
- **Confirm before:** opening a PR, merging to `main`, anything that publishes.
- **Never propose merging on red CI**, skipping a failing check, or relaxing
  all-or-nothing publishing to "ship the parts that worked."
- **Don't expand scope.** No build hooks, no custom `steps:`, no per-check
  inputs. A repo that doesn't fit a named build mode writes its own workflow —
  say so plainly rather than bending putitoutthere around it.
- **Don't rename `release.yml`** (or any release-path workflow) once a TP
  record points at it.
