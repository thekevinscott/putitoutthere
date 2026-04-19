# Migrating UpscalerJS to putitoutthere

Practical guide for wiring `putitoutthere` into UpscalerJS. Derived from a read-only audit of [`thekevinscott/UpscalerJS`](https://github.com/thekevinscott/UpscalerJS) at the time of writing: `pnpm-workspace.yaml`, root `package.json`, `packages/`, `models/`, and `.github/workflows/` (`browserlist.yml`, `docs.yml`, `tests.yml`, `update-lockfile.yml`).

**Goal:** add an automated release path that doesn't exist today. `npm i upscaler` continues to resolve to the same package; future model-package releases ship on the same cadence without operator toil.

---

## TL;DR

| Before (UpscalerJS)                                                          | After (putitoutthere)                                 |
|------------------------------------------------------------------------------|-------------------------------------------------------|
| No release workflow — `npm publish` run manually from dev machines, gated by `prepublishOnly` (lint + test + build) | `release.yml` (~60 lines) + `putitoutthere-check.yml` (PR dry-run) |
| Version bumps via ad-hoc `update:version` + `commit-latest-version-changes` wireit scripts | `release: <bump>` trailer on a merge commit drives the bump |
| No git tag on releases; version lives only in `package.json`                 | Per-package tags `{name}-v{version}` (e.g., `upscaler-v1.0.0`) |
| No GitHub Release created                                                    | GitHub Release per tag with auto-generated notes      |
| No OIDC; local creds on the developer machine                                | npm trusted publisher per package (per plan.md §16.4) |
| 18 workspace packages (`packages/*`, `models/*`, `dev/*`, `internals/*`, `docs/*`) mixed publishable + private | Only releasable units declared as `[[package]]`; the rest are skipped |

---

## Behavior changes to accept

1. **Releases become automated.** Today UpscalerJS ships manually via `pnpm publish` from a developer's machine, gated by the root `prepublishOnly` hook (lint + test + build). After migration, a merge to `main` with a `release: <bump>` trailer kicks off the same lint/build/test chain inside CI, then publishes. No more "who has credentials cached" dance.

2. **Per-package tags replace shared versions.** Each releasable unit gets its own `{name}-v{version}` tag. The main `upscaler` package and every released model package tag independently, so a patch to `@upscalerjs/esrgan-slim` doesn't drag the main library's version along.

3. **Model packages become explicit config.** Today every directory under `models/*` is a workspace; releases happen when a human remembers to bump + publish. Each model that actually ships to npm needs a `[[package]]` block. Development-only packages under `dev/*`, `internals/*`, `docs/*`, and the excluded paths from `pnpm-workspace.yaml` (`models/**/demo/**`, `dev/browser/public/models/**`, `docs/workers/upscale/**`) are not declared and simply don't release.

4. **Wireit build stays; prepublishOnly goes away.** The root `build` / test / lint wireit pipeline is still how CI produces the `dist/` trees. `release.yml`'s build step calls `pnpm run build` before handing off to putitoutthere. The `prepublishOnly` hook in `packages/upscalerjs/package.json` is now redundant — putitoutthere's pre-flight (§13.2) handles artifact completeness — but leaving it in place is harmless belt-and-suspenders.

5. **Browser-first shape needs no special build mode.** `upscaler` and the model packages are pure-JS ESM+UMD artifacts (no native binaries). Vanilla npm handler is sufficient — leave `build` unset on every `[[package]]`.

6. **Peer-dep governance stays in `package.json`.** The `@tensorflow/tfjs*` peerDependencies are unrelated to the release flow; putitoutthere doesn't touch them.

---

## Target `putitoutthere.toml`

The repo already publishes the main library as `upscaler` (unscoped) and model packages under `@upscalerjs/*`. Keep those registry names. Use internal `[[package]].name` values that make the tag form unambiguous.

```toml
[putitoutthere]
version     = 1
cadence     = "immediate"    # preserves current "ship when a human decides" feel; flip to "scheduled" if you want nightly

[[package]]
name         = "upscalerjs-core"
kind         = "npm"
npm          = "@upscalerjs/core"
path         = "packages/shared"             # TODO confirm once packages/shared is audited for publishability
paths        = ["packages/shared/**"]

[[package]]
name         = "upscaler"
kind         = "npm"
npm          = "upscaler"
path         = "packages/upscalerjs"
paths        = ["packages/upscalerjs/**"]
depends_on   = ["upscalerjs-core"]

# One [[package]] per published model. Names reflect the current @upscalerjs/* scope.
# Copy-paste this block for each of: default-model, esrgan-legacy, esrgan-medium,
# esrgan-slim, esrgan-thick, maxim-deblurring, maxim-dehazing-indoor,
# maxim-dehazing-outdoor, maxim-denoising, maxim-deraining, maxim-enhancement,
# maxim-retouching, pixel-upsampler.
#
# maxim-experiments is experimental — skip unless it's actually published.

[[package]]
name         = "upscalerjs-esrgan-slim"
kind         = "npm"
npm          = "@upscalerjs/esrgan-slim"
path         = "models/esrgan-slim"
paths        = ["models/esrgan-slim/**"]
depends_on   = ["upscalerjs-core"]
```

Private-by-intent packages (`dev/*`, `internals/*`, `docs/*`, `examples/*`, `tmp/bundlers/**`, `models/**/demo/**`) are simply not declared. Putitoutthere only publishes what's in the config.

---

## Target `release.yml`

Standard `putitoutthere init` output, with the build step wired to UpscalerJS's pnpm+wireit pipeline:

```yaml
- uses: pnpm/action-setup@v4
- uses: actions/setup-node@v4
  with: { node-version: 20, cache: pnpm }
- run: pnpm install --frozen-lockfile
- if: matrix.kind == 'npm'
  run: pnpm run build        # wireit builds every workspace package to dist/
```

`upload-artifact` stages `${{ matrix.artifact_path }}`; `publish` job calls `putitoutthere@v0 command: publish` with `id-token: write` (no token env block needed once trusted publishers are configured for each scope).

---

## Files to delete after migration

Nothing to delete today — UpscalerJS has no release workflows. Optional cleanups once the migration is confirmed:

- Root `package.json` scripts: `update:version`, `commit-latest-version-changes` (their logic is superseded by putitoutthere's version computation).
- `packages/upscalerjs/package.json` `prepublishOnly` hook (redundant; keep it if belt-and-suspenders feels safer).

---

## Step-by-step migration plan

1. Land v0 of `putitoutthere` (done — this repo is at v0).
2. Configure an npm Trusted Publisher for every scoped package (`upscaler`, `@upscalerjs/core`, each `@upscalerjs/*-<model>`), workflow `release.yml`. See plan.md §16.4.
3. `npx putitoutthere init --cadence immediate` at the repo root. Edit the generated `putitoutthere.toml` to add the `[[package]]` blocks listed above.
4. Dry-run: `npx putitoutthere plan --dry-run --json` — confirm the cascade reports only the packages you expect.
5. Open a PR with a `release: minor` trailer on the squash commit. `putitoutthere-check.yml` will fire a dry-run on the PR.
6. Merge. First release tags every declared package at `first_version` (default `0.1.0`) or the existing `package.json` version if higher. Verify.

---

## Verification checklist

- [ ] `npm view upscaler version` matches the post-merge tag.
- [ ] `npm view @upscalerjs/esrgan-slim version` matches its tag (and every other declared model).
- [ ] Tags land as `upscaler-v{version}`, `upscalerjs-core-v{version}`, `upscalerjs-<model>-v{version}`.
- [ ] GitHub Release per tag, with auto-generated notes.
- [ ] Peer-dep resolution against TFJS still works (regression check from `tests.yml`'s integration suite).
- [ ] CDN / unpkg consumers unaffected (URL shape is unchanged since package names don't move).

---

## Decisions locked in vs. left open

**Locked in:**
- Every model package gets its own `[[package]]` block; release cadence is per-model.
- `build` is unset for every package — vanilla npm handler.

**Left open:**
- **Scope for `upscalerjs-core` shared package.** The audit saw `packages/shared` in the workspace; whether it's published as `@upscalerjs/core` today or whether `packages/upscalerjs-wrapper` plays that role needs a one-line check against the registry before the config is final.
- **Model cadence.** Per-model `cadence` override is not a v0 feature. If some models should ship nightly while the main library ships immediately, the distinction has to live in how trailers get written, not config.

---

## Plan gaps surfaced

- **Partial:** `paths` globs for sibling model packages overlap via `models/**`. Putitoutthere's glob matcher handles this (each `[[package]]` narrows with its own prefix), but the cascade test in plan.md §11.4 should include a "sibling under common parent" case if it doesn't already.
- **Potential:** if model pretrained weights have a lifecycle distinct from model code, `depends_on` may under-cascade. Today model packages bundle weights; if that ever separates, revisit.
