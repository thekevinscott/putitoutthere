# Migrating dirsql to pilot

Practical guide for replacing dirsql's hand-rolled release tooling with
`pilot`. Derived from an audit of dirsql's current workflows
(`release.yml`, `publish.yml`, `patch-release.yml`, `publish-npm.yml`)
and release scripts (`scripts/release/*.py`) at the time of writing.

**Goal:** refactor is a no-op for end users. `pip install dirsql`,
`cargo add dirsql`, `npm i dirsql` all continue to work, versions
continue to move forward, release cadence is preserved.

---

## TL;DR

| Before (dirsql) | After (pilot) |
|---|---|
| 5 workflows, ~1000 lines of YAML | 2 workflows, ~60 lines |
| 3 Python release scripts + their tests | Deleted; logic is internal to pilot |
| Shared `v{version}` tag | Per-package `{name}-v{version}` tags |
| `[no-release]` commit marker | `release: skip` git trailer |
| `RELEASE_STRATEGY` repo var | `[pilot] cadence` in `pilot.toml` |
| Conditional tag rollback on failure | No rollback; artifact completeness prevents partial ship |
| cargo-dist binaries + custom npm synth | Same pattern via `build = "bundled-cli"` |
| Matrix hole silently ships sdist | Matrix hole aborts the package's release |
| `publish-pypi` gate bug class | Structurally impossible (pilot enforces completeness) |

---

## Behavior changes to accept

1. **Tag format changes.** Today dirsql tags once per release as
   `v0.2.0` covering all packages. After migration there are three
   tags per release: `dirsql-v0.2.0`, `dirsql-python-v0.2.0`,
   `dirsql-v0.2.0` (npm — will collide with crates name; see below).
   Consumers reading git tags for version info (unusual) would need
   to update. Nobody should actually be doing this.

   **One name collision to resolve:** the main npm package is
   currently named `dirsql`, matching the crates.io name. Under
   per-package tags they'd both try to create `dirsql-v{version}`.
   Options:
   - Rename the npm package internally in pilot.toml (e.g.,
     `name = "dirsql-npm"`, keep npm display name `dirsql`).
   - Rename the crates pilot entry (`name = "dirsql-crate"`, crate
     name on crates.io stays `dirsql`).
   - Accept tags for `dirsql` to be ambiguous and re-key the npm tag
     format (e.g., a per-package `tag_format` override — not in v0).

   **Recommendation:** name the pilot entries disambiguated internally
   (`dirsql-rust`, `dirsql-python`, `dirsql-cli`); the `name` in
   `pilot.toml` is internal and doesn't affect published package names.
   The published names stay `dirsql` / `dirsql` / `dirsql`.

2. **No automatic tag rollback.** Pilot does not delete tags on partial
   failure. The artifact completeness check prevents the class of bug
   that made rollback necessary in the first place: pilot refuses to
   publish any package whose matrix is incomplete. Partial publishes
   don't happen, so there's nothing to roll back.

   For the rare case where a publish succeeds on one registry and fails
   on another (e.g., crates.io accepts but PyPI rejects), you:
   - Fix the cause.
   - Re-run the workflow. Idempotency checks skip already-published
     versions; the failed leg retries cleanly.

   For the even rarer "published but broken" case, use
   `cargo yank` / `npm deprecate` + `git revert` + normal patch
   release. See `plan/plan.md` §19.

3. **Release signal syntax.** `[no-release]` anywhere in the commit
   message becomes `release: skip` as a trailer. Update
   `CLAUDE.md` / `AGENTS.md` (or your agent's rules) to emit the
   trailer.

4. **Cadence config location.** Move from a repo-level `RELEASE_STRATEGY`
   env var to `[pilot] cadence = "immediate"` (or `"scheduled"`) in
   `pilot.toml`. Pilot supports both modes natively (§9).

5. **Python release scripts go away.** `compute_version.py`,
   `resolve_publish_targets.py`, `check_published.py`, and their tests
   are deleted. Pilot owns that logic internally and tests it as part
   of its own suite.

6. **cargo-dist `release.yml` goes away.** Pilot's publish flow
   creates the GitHub Release itself (§15), with binary assets
   attached if `bundled-cli` handlers publish per-platform packages.
   If dirsql wants standalone archive assets on the GH Release
   (e.g., `.tar.xz` for curl-installable binaries), keep cargo-dist
   alongside pilot — but dogfood the simpler path first.

---

## Target `pilot.toml` for dirsql

```toml
[pilot]
version     = 1
cadence     = "scheduled"          # matches RELEASE_STRATEGY=nightly
agents_path = "pilot/AGENTS.md"

[[package]]
name          = "dirsql-rust"      # internal name; crate on crates.io stays "dirsql"
kind          = "crates"
path          = "packages/rust"
paths         = [
  "packages/rust/**",
  "Cargo.lock",
]
first_version = "0.1.0"

[[package]]
name          = "dirsql-python"
kind          = "pypi"
path          = "packages/python"
pypi          = "dirsql"           # name on PyPI
build         = "maturin"
targets       = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
]
paths         = ["packages/python/**"]
depends_on    = ["dirsql-rust"]    # PyO3 wrapper around the crate
first_version = "0.1.0"

[[package]]
name          = "dirsql-cli"
kind          = "npm"
path          = "packages/ts"
npm           = "dirsql"           # name on npm
build         = "bundled-cli"      # wraps the dirsql executable
targets       = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
]
paths         = ["packages/ts/**"]
depends_on    = ["dirsql-rust"]    # wraps the CLI binary from the crate
first_version = "0.1.0"
```

**Platform-package naming for npm.** Pilot publishes the per-platform
packages as `dirsql-{target}` (e.g., `dirsql-linux-x64-gnu`). If you
want to preserve the current `@dirsql/cli-{target}` scoped layout for
backward compatibility with existing installs, you'd need a per-package
override on platform-package naming — not in v0. For a fresh
namespace, the unscoped convention is simpler.

---

## Target `release.yml`

```yaml
name: Release

on:
  schedule:
    - cron: "0 2 * * *"     # 02:00 UTC, same as today's patch-release.yml
  workflow_dispatch:
    inputs:
      bump:
        description: "Version bump"
        required: false
        default: "patch"
        type: choice
        options: [patch, minor, major]
      packages:
        description: "Comma-separated package names to force-release"
        required: false

jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.p.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - id: p
        uses: thekevinscott/put-it-out-there@v0
        with: { command: plan }

  build:
    needs: plan
    if: needs.plan.outputs.matrix != '[]'
    strategy:
      fail-fast: false
      matrix:
        include: ${{ fromJson(needs.plan.outputs.matrix) }}
    runs-on: ${{ matrix.runs_on }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      # Maturin wheels for dirsql-python. The pre-build step bundles the
      # CLI binary into the wheel -- maturin's [tool.maturin] include
      # picks it up from _binary/.
      - if: matrix.kind == 'pypi' && matrix.target != 'sdist'
        name: Build CLI binary for wheel bundle
        shell: bash
        run: |
          rustup target add ${{ matrix.target }}
          cargo build --release --bin dirsql --features cli \
            --target ${{ matrix.target }} \
            --manifest-path packages/rust/Cargo.toml
          mkdir -p packages/python/python/dirsql/_binary
          if [ "${{ matrix.target }}" = "x86_64-pc-windows-msvc" ]; then
            cp "target/${{ matrix.target }}/release/dirsql.exe" \
               packages/python/python/dirsql/_binary/dirsql.exe
          else
            cp "target/${{ matrix.target }}/release/dirsql" \
               packages/python/python/dirsql/_binary/dirsql
            chmod +x packages/python/python/dirsql/_binary/dirsql
          fi
      - if: matrix.kind == 'pypi' && matrix.target != 'sdist'
        uses: PyO3/maturin-action@v1
        with:
          target: ${{ matrix.target }}
          args: --release --out dist --manifest-path packages/python/Cargo.toml --interpreter 3.10 3.11 3.12 3.13
          manylinux: auto

      - if: matrix.kind == 'pypi' && matrix.target == 'sdist'
        uses: PyO3/maturin-action@v1
        with:
          command: sdist
          args: --out dist --manifest-path packages/python/Cargo.toml

      # CLI binary for the npm bundled-cli package.
      - if: matrix.kind == 'npm'
        name: Build CLI binary for npm bundle
        shell: bash
        run: |
          rustup target add ${{ matrix.target }}
          cargo build --release --bin dirsql --features cli \
            --target ${{ matrix.target }} \
            --manifest-path packages/rust/Cargo.toml

      # Crates source package (no target matrix, but the matrix still
      # runs this row once).
      - if: matrix.kind == 'crates'
        run: cargo package --allow-dirty --manifest-path packages/rust/Cargo.toml

      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact_name }}
          path: ${{ matrix.artifact_path }}

  publish:
    needs: [plan, build]
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/download-artifact@v4
        with: { path: artifacts }
      - uses: thekevinscott/put-it-out-there@v0
        with: { command: publish }
        env:
          # OIDC is used when available for all three registries.
          # Tokens below are fallbacks; delete the env block entirely
          # once trusted publishers are configured for all three.
          CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}
          PYPI_API_TOKEN:       ${{ secrets.PYPI_TOKEN }}
          NODE_AUTH_TOKEN:      ${{ secrets.NPM_TOKEN }}
```

**PR check** — `.github/workflows/pilot-check.yml`:

```yaml
on: pull_request

jobs:
  pilot-check:
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

---

## Files to delete after migration

```
.github/workflows/patch-release.yml
.github/workflows/publish.yml
.github/workflows/publish-npm.yml
.github/workflows/release.yml               # (the cargo-dist autogen one)
.github/workflows/release-scripts.yml
scripts/release/                            # whole directory
tools/buildPlatforms.ts
tools/syncVersion.ts
```

Keep:
- `Cargo.toml` workspace version field (pilot bumps it at publish time).
- `pyproject.toml` version field (same).
- `packages/ts/package.json` version field (same).
- The `_binary/` staging pattern in `packages/python/python/dirsql/` —
  pilot doesn't replace this. The `release.yml` build step above does
  the same staging.

---

## Step-by-step migration

Done sequentially to minimize risk. Each step is independently
verifiable before moving on.

### Step 1: land pilot v0

Wait until pilot ships v0 on npm as `pilot` and the GHA action is
tagged `thekevinscott/put-it-out-there@v0`. Don't start migration
against a moving target.

### Step 2: set up trusted publishers

Configure trusted publishers for the dirsql repo on all three
registries. See `plan/plan.md` §16.4 for step-by-step. Critical:

- PyPI trusted publisher must reference the **new** workflow filename
  (`release.yml`, not `patch-release.yml`). If you keep the filename
  `patch-release.yml` during the transition, update the trust policy
  at cutover.
- crates.io trusted publisher: same filename constraint.
- npm: uses `id-token: write` + `--provenance`; no per-package setup.

Keep existing tokens as fallback during migration.

### Step 3: create `pilot.toml`

Copy the config from this document into `pilot.toml` at the repo root.
Adjust `targets` lists if you want to drop/add platforms.

### Step 4: run `pilot doctor` locally

```bash
npx pilot doctor
```

Should report:
- `pilot.toml` parses.
- All three handlers resolve (`crates`, `pypi` w/ maturin,
  `npm` w/ bundled-cli).
- `targets` lists are sane.
- No auth checks (doctor running locally skips the env-var check;
  see step 6 for CI-side validation).

Fix any errors before proceeding.

### Step 5: create `release.yml` and `pilot-check.yml` (disabled)

Add the two workflows from this document. To keep them inert during
the transition, either:
- Gate `release.yml` on a boolean repo var: `if: vars.PILOT_ENABLED == 'true'`
- Or temporarily rename them to `release.yml.disabled` until cutover.

### Step 6: run a dry-run manually

```bash
gh workflow run release.yml -f bump=patch
```

Watch the run. Expectations:
- `plan` job emits a matrix covering all three packages × their targets.
- `build` job runs matrix rows but doesn't publish.
- `publish` job aborts because no tag has been created yet (dry-run
  mode skips destructive ops).
- Pre-flight auth check passes (tokens visible in env).

If anything is unexpected, fix before step 7.

### Step 7: cut over

In a single commit:

1. Enable `release.yml` (flip the `vars.PILOT_ENABLED` to `true`, or
   rename the file back).
2. Delete the files listed under "Files to delete."
3. Update `CLAUDE.md` / `AGENTS.md` to teach the agent the
   `release: skip` trailer convention (runs `pilot init` to do this
   idempotently).
4. Commit with `release: skip` in the trailer so the cutover itself
   doesn't trigger a release.

### Step 8: first real release

`workflow_dispatch` with `bump=patch` and a known commit that touches
all three packages. Verify:

- All three registries show the expected new version.
- Three tags exist: `dirsql-rust-v{N}`, `dirsql-python-v{N}`,
  `dirsql-cli-v{N}`.
- One GitHub Release per tag, with auto-generated notes.
- `optionalDependencies` on the main `dirsql` npm package points at
  the just-published `dirsql-{target}` packages.
- `pip install dirsql==<N>` installs the wheel with the bundled CLI.
- `cargo install dirsql --version <N>` installs the CLI.
- `npm i -g dirsql@<N>` installs; `dirsql --version` reports `<N>`.

### Step 9: remove token fallback (optional)

Once trusted publishers have landed at least one release successfully,
delete the `env:` block in the publish step of `release.yml`. Tokens
stay as repo secrets in case you need to fall back.

---

## Verification checklist

Post-migration, confirm:

- [ ] `dirsql` on crates.io at the new version, source-only as before.
- [ ] `dirsql` on PyPI at the new version, with 5 platform wheels
      (each bundling the CLI) + 1 sdist.
- [ ] `dirsql` on npm at the new version; main package has
      `optionalDependencies` pointing at `dirsql-{target}` at the
      same version.
- [ ] Platform packages `dirsql-{linux-x64-gnu,...}` exist on npm
      at the same version.
- [ ] Three per-package tags on the repo.
- [ ] One GitHub Release per tag.
- [ ] Previous versions remain available; no yanks triggered.
- [ ] No `scripts/release/` directory in the repo.
- [ ] No `tools/buildPlatforms.ts` or `tools/syncVersion.ts`.
- [ ] `.github/workflows/` contains exactly `release.yml`,
      `pilot-check.yml`, plus dirsql's non-release workflows
      (`docs.yml`, `python-test.yml`, `ts-test.yml`, `rust-test.yml`,
      etc.).
- [ ] Scheduled release fires at the next cron window; no-op if no
      changes merged, otherwise ships patch.

---

## Rollback plan (in case pilot misbehaves)

If a release under pilot goes badly, the rollback is to restore the
old workflows. Because pilot's no-push model doesn't modify `main`,
the git state is clean:

1. Revert the commit from step 7 (cutover).
2. Re-enable the old workflows.
3. Any versions that shipped under pilot remain published (that's fine
   — they're real releases).
4. The next release goes through the old path.

No rollback of published artifacts is needed or possible — same as
today.

---

## Open questions for the dirsql side

These aren't pilot decisions; they're things you'll decide when
actually doing the migration:

1. **Keep or drop the `@dirsql/cli-{target}` scoped naming?** Switching
   to unscoped `dirsql-{target}` is simpler but breaks existing
   installations that pin those names (unlikely — the main `dirsql`
   package handles the resolution).

2. **Keep cargo-dist for standalone binary archives?** Pilot generates
   the GH Release and attaches per-platform packages as assets. If
   users rely on `.tar.xz` / `.zip` archives served from the GH Release
   (for curl-to-install scripts), cargo-dist still adds value. Decide
   whether to keep it as a parallel workflow or drop it.

3. **Python package name: `dirsql` or `dirsql-python`?** The pilot
   config uses `name = "dirsql-python"` internally and `pypi = "dirsql"`
   externally. Tags are `dirsql-python-v{N}`. If that's a problem for
   discoverability (e.g., someone searching the repo for `dirsql v0.2.0`
   tags and finding three), you could rename internally to `dirsql`
   and deal with the namespace collision differently (per-package
   `tag_format` override — not v0).

4. **Scheduled cron window.** Current is 02:00 UTC daily. Keep or
   change on cutover.
