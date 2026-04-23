## Scope of the existing release machinery

~47 KB across 13 workflow files and 7 Python helpers. It does 15 distinct things:

1. Parse tag / detect prerelease (`release.yml:45`)
2. Bump semver, skip empty patch (`scripts/release/compute_version.py:13,43`)
3. Detect which of {rust,python,js,docs} changed since last tag via glob matching (`resolve_publish_targets.py:27–46`)
4. Build Rust binaries per-platform via cargo-dist (`release.yml` — 5 targets in `dist-workspace.toml:6–26`)
5. Stage the CLI binary into `packages/python/python/dirsql/_binary/` before maturin runs (`publish.yml:172–188`)
6. Build wheels via `PyO3/maturin-action` for CPython 3.10–3.13 (`publish.yml:190–193`)
7. Build sdist (`publish.yml:214–217`)
8. Build napi `.node` addons per-platform (`publish-npm.yml:30`)
9. Synthesize per-platform CLI packages (`tools/buildPlatforms.ts`, `publish-npm.yml:139–144`)
10. Synthesize per-platform napi lib packages (`tools/buildLibPlatforms.ts`, `publish-npm.yml:153–158`)
11. Idempotent registry pre-check (`scripts/release/check_published.py`)
12. OIDC publish to PyPI, crates.io, npm (`publish.yml:252–260, 304; publish-npm.yml`)
13. Inject `optionalDependencies` into top-level package.json then publish (`tools/syncVersion.ts`, `publish-npm.yml:170–176`)
14. Create GitHub Release (`publish.yml:330`)
15. Rollback tag on dual failure (`publish.yml:350`)

Plus triggers: daily cron + push-to-main + manual dispatch (`patch-release.yml:10–48`), and `release-scripts.yml` runs pytest+actionlint on the helpers.

## What piot covers (high-fit match)

The piot docs have a handoff guide literally titled **"Polyglot Rust library (dirsql shape)"** (`/put-it-out-there/guide/handoffs/polyglot-rust`). That's not incidental — piot is shaped for exactly this. Items 2, 3, 6, 8, 9, 10, 11, 12, 13, 14 above map directly onto piot primitives:

| dirsql thing | piot replacement |
|---|---|
| `resolve_publish_targets.py` | cascade via `paths` globs + `depends_on` (Concepts → Cascade) |
| `compute_version.py` bump logic | `release: patch\|minor\|major` commit trailer |
| `check_published.py` | built-in handler `isPublished` pre-check (Concepts → Idempotency) |
| OIDC to all 3 registries | piot's core claim; OIDC-first design |
| `tools/buildLibPlatforms.ts` + `syncVersion.ts` | `kind = "npm"`, `build = "napi"` |
| `tools/buildPlatforms.ts` | `kind = "npm"`, `build = "bundled-cli"` |
| Topological crate→wheel→npm ordering | `depends_on` topo sort (handoff config example) |
| Per-SDK tag + GitHub Release | built-in, tags as `{name}-v{version}` |

What stays in dirsql's workflow (piot is publish-side only, per the Concepts page's "Explicitly out of scope"): the build matrix, runner pins (`ubuntu-24.04-arm`, `macos-14`), `maturin build --target`, `napi build --target`, the CLI-into-wheel staging step, cargo-dist for tarballs on GitHub Releases, and CHANGELOG.md. None of those are a loss — they're not what the custom code does anyway.

## Concrete blockers, ranked

**1. piot is not installable yet.** The docs are served from `http://localhost:51945`, which is your local dev server. `npx putitoutthere init` (Getting started → Install) will 404 against npm today. Until piot publishes a v0.1.0 to npm — and a companion GitHub Action if `release.yml` uses `uses: thekevinscott/put-it-out-there@v1` — dirsql cannot adopt it. **This is the #1 fix on the piot side and the one thing most in your control.**

**2. Combined CLI + napi in one top-level npm package is explicitly unsupported.** From Known gaps → "Combined CLI + napi under one top-level package": *"piot cannot publish a single dirsql top-level whose optionalDependencies mix both @dirsql/cli-<slug> (CLI binaries via bundled-cli) and @dirsql/lib-<slug> (napi addons via napi). If you need that shape, split into two published names."* That is dirsql's current shape exactly — `publish-npm.yml:165` loops over both `target/npm-platforms/*` AND `target/npm-lib-platforms/*`, and `tools/syncVersion.ts` pins both families under one top-level `dirsql`. Adopting piot forces either (a) splitting into `dirsql` (napi lib) + `dirsql-cli` (CLI), which is a user-visible break of `npm i dirsql && dirsql --help`, or (b) a piot enhancement that lifts this restriction. Given the handoff guide is *called* "dirsql shape", (b) seems worth filing — the guide's own example only declares a `build = "napi"` package and quietly omits a CLI family.

**3. `features` passthrough on `cargo publish` is broken.** Known gaps → Not yet shipped → [#169]: *"`kind = "crates"` handler: pass `features` through to `cargo publish`. Config schema has it; handler silently drops it today."* The handoff example uses `features = ["cli"]` — so the guide's own canonical dirsql config doesn't currently work as documented. Blocks dirsql until #169 ships.

**4. Tag scheme changes `v0.3.1` → `{name}-v0.3.1`.** Known gaps → "Per-package tags, not a single shared version". Concrete consequences: `release.yml:45` fires on `[0-9]+.[0-9]+.[0-9]+*` — cargo-dist's trigger has to be repointed (e.g. to `dirsql-rust-v*`) or dirsql loses its standalone binary archives. Migration work, not a blocker.

**5. Daily cron is documented but thin.** Configuration shows `cadence = "scheduled"` under `[putitoutthere]`, but Getting started says *"piot is not a cron-driven release orchestrator at the tool level (though you can run it from a cron workflow)."* dirsql's `patch-release.yml` runs on `cron: '0 2 * * *'` and calls `publish.yml` as a reusable workflow. The adoption story for that trigger isn't written out in the docs I saw. Not a blocker — you can keep the cron trigger in your own workflow and just invoke piot from it — but worth documenting.

**6. Rollback job goes away.** `publish.yml:350` deletes the tag on dual failure. Known gaps → "Auto tag-rollback" is a permanent non-goal; piot relies on the pre-publish completeness check instead. Behavioral change, probably fine, worth calling out.

## What I'd do

- **File three piot issues**: (a) **publish + distribute piot itself** (blocker 1); (b) **support mixed-family top-level `optionalDependencies`** since "dirsql shape" in the docs doesn't yet fit actual dirsql (blocker 2); (c) confirm timeline on [#169] (blocker 3).
- **Don't migrate dirsql yet.** Once (a) and (c) are shipped and you've decided on (b), the migration is small: delete `scripts/release/*.py`, delete `tools/{buildPlatforms,buildLibPlatforms,syncVersion}.ts`, replace the guts of `publish.yml` and `publish-npm.yml` with a piot invocation, add `putitoutthere.toml`. Your `build` job and cargo-dist `release.yml` stay untouched.
- **Be honest about the ROI for dirsql specifically.** The day of work has already been paid. The value is (i) for the *next* polyglot library you author, and (ii) for dirsql the ongoing maintenance drop on ~700 lines of bespoke YAML+Python. If you're not willing to split the npm package, blocker 2 is load-bearing and the honest answer is "no, not without a piot change."
