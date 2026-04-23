## Evaluation: can dirsql adopt piot?

### Existing release machinery (what piot would replace)

From the inventory: `.github/workflows/patch-release.yml` (cron 02:00 UTC + push-on-main + dispatch) decides what to ship; `scripts/release/compute_version.py` bumps one shared `vX.Y.Z`; `resolve_publish_targets.py` does path-glob change detection per SDK; `check_published.py` does idempotent registry pre-checks; `publish.yml` handles crates.io + PyPI; `publish-npm.yml` synthesises per-platform npm families; `release.yml` uses `cargo-dist` for curl-installable archives. OIDC on PyPI + crates.io; long-lived `NPM_TOKEN` for npm. Manual tag-rollback if PyPI+crates both fail.

### What piot already covers for this shape

The "Polyglot Rust library (dirsql shape)" handoff guide is literally written for us. Concretely, piot 1:1 replaces:

| dirsql today | piot equivalent |
|---|---|
| `resolve_publish_targets.py` glob detection | `paths = [...]` + transitive `depends_on` cascade (Concepts → Cascade) |
| `compute_version.py` (`BUMP_TYPE`) | `release: patch\|minor\|major [pkgs]` trailer |
| `check_published.py` | Per-handler `isPublished` GET pre-check (Concepts → Idempotency) |
| `publish.yml` crates + PyPI-wheels | `kind = "crates"` + `kind = "pypi"` `build = "maturin"` |
| `publish-npm.yml` `@dirsql/lib-*` family | `kind = "npm"` `build = "napi"` (napi family synth) |
| `publish-npm.yml` `@dirsql/cli-*` family | `kind = "npm"` `build = "bundled-cli"` (bundled-cli family synth) |
| Topo ordering (crate before wheel before npm) | `depends_on = ["dirsql-rust"]` enforces this |
| OIDC on PyPI + crates | OIDC on all three — **gains npm trusted publishing**, lets us delete `NPM_TOKEN` |
| `release.yml` `cargo-dist` curl-install archives | Explicitly "compose with cargo-dist" — no change |

### Hard blockers (dirsql cannot adopt piot today)

**1. Combined CLI + napi top-level package is documented as unsupported.**
`packages/ts/tools/syncVersion.ts:4-5` ships a single top-level `dirsql` npm package whose `optionalDependencies` mixes **both** `@dirsql/cli-<slug>` **and** `@dirsql/lib-<slug>`. The Known gaps page ("Combined CLI + napi under one top-level package") states verbatim: *"piot cannot publish a single `dirsql` top-level whose `optionalDependencies` mix both `@dirsql/cli-<slug>` … and `@dirsql/lib-<slug>` … If you need that shape, split into two published names (e.g. `dirsql` for the napi library, `dirsql-cli` for the CLI)."* That's a public npm-API breaking change for our users. **This is the single biggest adoption barrier.**

**2. Piot's crates handler silently drops `features` (issue #171 #169).**
`packages/rust/Cargo.toml:9,46` declares `[features]` with `required-features = ["cli"]` for the `dirsql` binary. We publish with `cargo publish --features cli`. The Known gaps page ("Not yet shipped") says: *"#169 — `kind = "crates"` handler: pass `features` through to `cargo publish`. Config schema has it; handler silently drops it today."* Until #169 lands, piot can accept our config but won't actually publish the CLI binary correctly.

**3. Installation story is unclear.**
The docs' only install reference is `npx putitoutthere init`, which is the scaffolder. The workflow it scaffolds (`plan → build → publish`) needs a piot executable to run in CI, but nothing in the Getting Started, Concepts, or dirsql-shape handoff tells you how GitHub Actions actually obtains it — no `uses: putitoutthere/action@v1`, no container image, no `npm i -g`/`cargo install`/`pipx install` mention. The sidebar has no "Install" or "CI setup" entry beyond the one-line scaffold command. **A library whose goal is to let others skip a day of release wiring needs an explicit "drop this into your workflow" snippet on day one.** This is the gap I'd insist piot close before we adopt.

### Soft / acceptable changes

- **Tag scheme change.** `v0.3.1` → `{name}-v0.3.1` (documented in "Per-package tags" gotcha). Mechanical find-and-replace across docs/scripts; no existing consumers read our tags today.
- **No auto tag-rollback.** Our current `publish.yml` deletes the tag if both PyPI and crates fail. Piot refuses this on correctness grounds (crates immutability). Acceptable — the idempotent pre-check covers the motivating failure mode.
- **Changelogs.** `CHANGELOG.md` stays; delegate generation to `release-please` or keep it manual. Not a blocker.
- **Cron trigger.** Piot is trailer-driven, but the docs explicitly allow running the CLI from a cron workflow. Our daily 02:00 schedule stays; we'd invoke `putitoutthere` from it.
- **cargo-dist stays.** Piot explicitly cedes curl-install archives to cargo-dist. Compose, don't replace.
- **Python dynamic versions (#171).** N/A — `packages/python/pyproject.toml:7` is `version = "0.1.0"` static.

### Concrete adoption plan (once blockers #1 and #3 are resolved)

1. **Split npm publishing into two names.** Ship `dirsql` (napi library only, `build = "napi"`) and a new `dirsql-cli` (`build = "bundled-cli"`). Announce breaking change. Without this, piot literally cannot publish our current shape.
2. **Wait for piot #169** (or contribute it) so `cargo publish --features cli` works.
3. **Write `putitoutthere.toml`** per the handoff guide's shape (three `[[package]]` entries, `depends_on = ["dirsql-rust"]` on the two downstreams).
4. **Register trusted publishers** on crates.io, PyPI, and npm against the new `release.yml` filename (one-time, out-of-CI; `doctor` can't verify this).
5. **Retire** `scripts/release/*.py`, `patch-release.yml`, `publish.yml`, `publish-npm.yml`. Keep `release.yml` (cargo-dist) running in parallel.
6. **Adopt `release:` trailer convention** in merge commits; add the `putitoutthere/AGENTS.md` trailer rules to this repo's AGENTS.md.

### Bottom line

Piot is a strong structural fit — the documentation explicitly models "the dirsql shape" and the feature set maps cleanly onto ~90% of what our machinery does. But **we cannot adopt it today**: piot's config+handler coverage for `features` on crates is incomplete (#169), its combined-family npm shape matches our current public API only by renaming one of our npm packages, and its install path is underspecified. Fix install docs + #169 in piot, then absorb the npm split as a one-time breaking change on our side, and the migration is straightforward.
