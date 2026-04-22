I'll skip the external npm check (needs approval) and flag it as an open question instead. I have enough to give a real evaluation.

---

## Scope of the existing dirsql release process

There are **7 release-related workflows** and **3 Python helpers** covering ~600+ lines of YAML plus ~200 lines of Python. The work splits into six concerns:

| # | Concern | Where it lives |
|---|---|---|
| 1 | Version compute + tag creation + rollback | `publish.yml` (tag job, rollback job) + `scripts/release/compute_version.py` |
| 2 | Change detection ("what needs to publish?") | `patch-release.yml` (detect-changes job) + `scripts/release/resolve_publish_targets.py` |
| 3 | Idempotency — skip already-published versions | `scripts/release/check_published.py` (probes crates/PyPI/npm) |
| 4 | Registry publish: crates.io + PyPI (maturin) | `publish.yml` (build matrix × 5 target triples, sdist, publish-pypi, publish-crates) |
| 5 | npm: TS SDK + per-platform `@dirsql/cli-*` + `@dirsql/lib-*` (esbuild-style optionalDependencies) | `publish-npm.yml` + `packages/ts/tools/{buildPlatforms,buildLibPlatforms,syncVersion}.ts` |
| 6 | GitHub Release artifacts (`*.tar.xz`, installers, checksums) | `release.yml` (cargo-dist) + `dist-workspace.toml` |

Plus load-bearing quirks: the file is named `patch-release.yml` because crates.io/npm OIDC trust policies hash the caller filename (`patch-release.yml:1-4`); `publish.yml:161-188` stages a pre-built `dirsql` CLI binary into the Python wheel before maturin runs; rollback only deletes the tag when **both** publishes fail (`publish.yml:350-364`). A day of work, as you said.

---

## What piot already covers

Strong matches, evidence cited:

- **All three registries as first-class handlers** — Configuration page: `kind = "crates" | "pypi" | "npm"`; SDK page lists `src/handlers/{crates,pypi,npm}.ts`. Covers concern #4.
- **OIDC trusted publishing for all three** — Authentication page walks through crates.io / PyPI / npm registration; describes the workflow permissions block (`id-token: write`) verbatim. Replaces `rust-lang/crates-io-auth-action@v1` and `pypa/gh-action-pypi-publish@release/v1` usages in `publish.yml`.
- **Long-lived token fallback** — same page documents `CARGO_REGISTRY_TOKEN`, `PYPI_API_TOKEN`, `NODE_AUTH_TOKEN`. Parity with dirsql's current `NPM_TOKEN`-based `publish-npm.yml`.
- **Change detection via glob cascade** — Cascade page's two-pass resolver (direct match on `paths`, then transitive `depends_on`). This is exactly `resolve_publish_targets.py`'s bucket scheme, but with per-package globs instead of hard-coded `_RUST_GLOBS`/`_PYTHON_GLOBS`/`_JS_GLOBS`. Replaces concern #2.
- **Topological publish order** — Concepts page: "packages publish in topological order of their `depends_on` graph." This is the "Rust first, then maturin" invariant dirsql currently encodes implicitly by job ordering.
- **Idempotency** — Concepts page: "Every handler's first move is `isPublished`." Replaces `check_published.py` (concern #3).
- **First-release handling** — Cascade page: "No prior tag matching `{name}-v*.*.*`? Treat as changed since beginning of time; version from `first_version`." Matches `resolve_publish_targets.py:81-83` and `compute_version.py:29-32`.
- **Trailer-driven bumps** — `release: minor [my-py]` supersedes dirsql's `workflow_dispatch.inputs.bump_type` + `publish_mode=custom` booleans. `release: skip` replaces the `[no-release]` commit-message marker (`patch-release.yml:82-91`).
- **Immediate vs scheduled cadence** — `cadence = "immediate" | "scheduled"` replaces the `vars.RELEASE_STRATEGY` logic (`patch-release.yml:62-96`).
- **napi per-platform orchestration** — `kind = "npm"` with `build = "napi"` + `targets` directly replaces `publish-npm.yml`'s build-napi matrix **plus** `packages/ts/tools/buildLibPlatforms.ts` + `syncVersion.ts`. This is the single biggest chunk of hand-rolled code piot eliminates.
- **CLI bundled via optionalDependencies** — `build = "bundled-cli"` + `targets` looks like it replaces `buildPlatforms.ts`.
- **GitHub Action wrapper** — `thekevinscott/put-it-out-there@v0` with `command: plan|publish|doctor`. The minimal workflow in API → GitHub Action page shows the plan/publish fan-out shape directly.
- **Config validation + auth preflight** — `putitoutthere doctor` + `token list --secrets` (Authentication page) exceeds dirsql's current "look at GH_TOKEN and hope for the best" posture.

**Rough coverage: ~70% of dirsql's release YAML + 100% of its Python helpers.**

---

## Gaps and blockers

### Blocker 1 — No pre-build hook for "bake a Rust binary into the Python wheel"

`publish.yml:172-188` does this:
```
cargo build --release --bin dirsql --features cli --target $TRIPLE
cp target/$TRIPLE/release/dirsql packages/python/python/dirsql/_binary/dirsql
# ... then maturin-action runs
```

Nothing in `putitoutthere.toml`'s `kind = "pypi"` schema (Configuration page: `build`, `targets`) expresses "run this command first and stage the output into the wheel." This is dirsql-specific but critical — without it, piot adoption means abandoning the single-wheel-ships-CLI pattern.

**Needed:** a `pre_build` / `stage` hook per-package, or a separate `kind` (e.g. `build = "maturin+binary"`).

### Blocker 2 — No GitHub Release artifact pipeline (cargo-dist parity)

dirsql's `release.yml` (cargo-dist) produces `dirsql-*.tar.xz` per target, shell installer, checksums, a `dist-manifest.json`, and drives the GitHub Release page. `publish-npm.yml:130-137` then **downloads those archives** (`gh release download "$TAG" --pattern 'dirsql-*.tar.xz'`) and rewraps them as per-platform npm CLI packages.

piot's docs describe registry publishing only. No mention of:
- Standalone `curl | sh` installer
- Homebrew formula / tap
- cargo-binstall manifest
- Per-target archive uploads to the GH Release

The `publish` concept (Concepts page) says it "creates a GitHub Release" but says nothing about what artifacts land on it beyond the per-kind registry uploads. If piot's `kind = "npm"` with `build = "bundled-cli"` builds its own per-target binaries for npm, dirsql could pivot `publish-npm.yml`'s "download cargo-dist tarball → rewrap" pattern into "build binary → publish directly" — but the broader cargo-dist outputs (shell installer, homebrew, checksums) would still need cargo-dist to coexist, which undoes the "one flow" promise.

**Needed:** either piot documents how to emit GH Release archives / installers, or the pitch explicitly scopes to registry publishing and accepts cargo-dist alongside.

### Blocker 3 — Lockstep vs per-package versioning, undocumented

dirsql ships a **single global tag** `v0.x.y` with the same version in Cargo.toml (`version.workspace = true`), `pyproject.toml`, and `package.json`. `publish.yml:282-288` rewrites only the workspace root version because every member inherits. Every release is in lockstep.

piot's Cascade page says "No prior tag matching `{name}-v*.*.*`" — implying **per-package tags**. Nothing in the docs describes a lockstep mode. If piot only supports per-package tags:
- dirsql loses its "one commit == one version" invariant
- `Cargo.toml`'s `version.workspace = true` stops working as a single bump point
- GitHub Release creation fragments into three releases per "release moment"

**Needed:** either piot supports a lockstep mode explicitly, or dirsql decides to move to per-package versions as part of migration.

### Blocker 4 — The `build` job shape is undocumented

The Concepts page declares a three-job pipeline: `plan → build → publish`, with "User-owned build steps produce the artifacts." The GitHub Action page's minimal workflow, however, shows only `plan → publish` with no build step. The CLI reference says `init` scaffolds `.github/workflows/release.yml` with the full pipeline but **never shows its contents**.

For dirsql the build job is where 90% of the CI time lives: maturin across 5 triples, napi across 5 triples, the cargo-dist matrix. I can't evaluate whether piot's scaffolded build can match dirsql's matrix without running `init`. If the matrix structure is fixed (one row per `package × target`), that's probably fine; if it's hard-coded per handler, dirsql-specific extras (binary staging, wireit, pnpm) may not fit.

**Needed:** docs page showing the scaffolded `release.yml` contents, specifically the build job's matrix shape and whether user steps can be injected.

### Blocker 5 — Trusted-publisher filename migration unspecified

The Authentication page says "fill in the workflow filename (e.g. `release.yml`)" for all three registries. `init` scaffolds `release.yml`. **dirsql's existing crates.io and npm trust policies are registered against `patch-release.yml`** (`patch-release.yml:1-4`). Adoption forces one of:
- Re-register trust policies on every registry (straightforward but requires separate UI steps per registry)
- Rename piot's scaffolded workflow — docs don't say this is supported, and the `init` command has no `--workflow-name` flag

Minor blocker — a one-time cost, but invisible in the docs.

### Gap 1 — No rollback semantics documented

dirsql's `rollback` job (`publish.yml:350-374`) deletes the pushed tag **only if both PyPI and crates publishes failed** — because a successful crates.io publish is permanent and a dangling tag would leave a real release pointing at a missing ref. piot's docs describe idempotency (`isPublished` skips already-published versions) but say nothing about what happens when one handler succeeds and another fails. The publish concept just lists "write version file, run handler's publish, create tag, create GitHub Release." What's the ordering? Is the tag pushed before or after the handlers? If after, a mid-flight failure leaves registries published with no tag; if before, a failure leaves a dangling tag.

**Needed:** a "Failure handling" section in Concepts or Publishing.

### Gap 2 — Docs-touches-everything fan-out

`resolve_publish_targets.py:42-46` treats `**/*.md` as a "docs" bucket that re-publishes all three SDKs (README updates land in every distributed package). Under piot, each package would need `**/*.md` in its `paths` array. Ugly but works — not a blocker. Worth noting because it's a common pattern.

### Open question — Is piot actually installable?

Docs say `npx putitoutthere init` and `uses: thekevinscott/put-it-out-there@v0`. I couldn't verify either without sandbox-approved network calls (npm / github) being declined. **Before committing to migration, run `npx putitoutthere@latest init` in a throwaway worktree and confirm the package exists and the scaffolded `release.yml` matches the documented pipeline.** If it doesn't exist yet, that's the blocker — the whole point of piot is to save the day of work, and un-shipped docs don't save any work.

---

## Bottom line

**Adopt piot for concerns #1–#3 and the napi half of #5 today.** That deletes ~300 lines of YAML plus all three Python scripts plus `buildLibPlatforms.ts`/`syncVersion.ts`. The trailer + cadence model is strictly better than dirsql's current `workflow_dispatch` inputs.

**Keep cargo-dist (`release.yml` + `dist-workspace.toml`) alongside piot** until blocker #2 is resolved. piot and cargo-dist are complementary, not overlapping — one does registries, the other does standalone binary distribution.

**Three things must change or be built before full migration:**
1. piot needs a pre-build hook (or `build = "maturin+binary"` kind) to express the "stage Rust binary into wheel" pattern. Until then, dirsql's Python release cannot migrate.
2. piot needs to either document a lockstep mode or dirsql needs to commit to per-package versions as part of migration.
3. Verify `putitoutthere` is actually on npm and `thekevinscott/put-it-out-there@v0` actually exists. The docs site alone is not evidence of a shippable tool.

My recommendation: spike `npx putitoutthere init` on a fork this week, answer the three questions above, and if (1) is a no — open an issue on piot proposing the pre-build hook. That's the minimum piot needs to grow before dirsql can fully cut over, and it's a small API addition rather than a redesign.
