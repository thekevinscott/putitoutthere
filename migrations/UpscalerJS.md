# Migrating UpscalerJS to putitoutthere

Audit draft. UpscalerJS is a JavaScript image-upscaling library published to npm as `upscaler`, with a monorepo structure (`packages/upscalerjs`, `packages/core`, `packages/scripts`, example sites, pretrained model packages).

> **Status:** skeleton only. Full audit requires cloning and reading `.github/workflows/` + any release scripts. TODO markers flag the spots that need a real-repo pass.

---

## TL;DR

| Before (UpscalerJS) | After (putitoutthere) |
|---|---|
| <TODO: enumerate workflows> | 2 workflows (release.yml + putitoutthere-check.yml) |
| <TODO: models packages shipped separately?> | One `[[package]]` per releasable unit in `putitoutthere.toml` |
| <TODO: tag format — `v*` or `@upscalerjs/core@*`?> | Per-package `{name}-v{version}` tags |
| Manual bump + publish via `pnpm publish` + `changesets`? TODO | Trailer-driven (`release: minor`) |

---

## Behavior changes to accept

1. **Monorepo scope.** `putitoutthere` assumes `[[package]]`s in the same repo release independently but share a config. UpscalerJS's monorepo layout (packages/*/package.json) fits naturally — each package under `packages/` becomes a `[[package]]` in `putitoutthere.toml`.
2. **Model packages.** If pretrained model packages (e.g. `@upscalerjs/esrgan-slim`) release on a different cadence than the main library, declare them as separate `[[package]]` blocks with disjoint `paths` globs.
3. **Tensorflow.js peer dep.** Peer deps don't affect `putitoutthere`'s release flow — they stay in `package.json` untouched.
4. **Browser-first build.** Vanilla npm path suffices. `putitoutthere`'s `build` field stays unset; the user's build job runs whatever bundler produces the dist tree.
5. **TODO:** verify there are no native binaries or platform-specific packages. If there are, switch to `build = "bundled-cli"` or `build = "napi"`.

---

## Target `putitoutthere.toml`

```toml
[putitoutthere]
version = 1

[[package]]
name = "upscalerjs-core"
kind = "npm"
npm = "@upscalerjs/core"
path = "packages/core"
paths = ["packages/core/**"]

[[package]]
name = "upscalerjs"
kind = "npm"
npm = "upscaler"
path = "packages/upscalerjs"
paths = ["packages/upscalerjs/**"]
depends_on = ["upscalerjs-core"]

# TODO: add [[package]] blocks for each model package under packages/models/
```

---

## Target `release.yml`

Use `putitoutthere init` output verbatim. The `build` step should run:

```yaml
- if: matrix.kind == 'npm'
  run: |
    cd ${{ matrix.path }}
    pnpm install --frozen-lockfile
    pnpm run build
```

---

## Files to delete after migration

- <TODO: list workflows replaced by putitoutthere's>
- <TODO: `.changeset/` if using changesets — putitoutthere subsumes it>

---

## Step-by-step migration plan

See `_template.md`.

---

## Verification checklist

- [ ] `npm view upscaler version` matches the new tag.
- [ ] Model packages still publishable independently.
- [ ] CDN / unpkg consumers unaffected.
- [ ] TypeScript declaration bundling still works.

---

## Plan gaps surfaced

- [ ] **Potential:** if model packages have a pretrained-weights lifecycle distinct from code, `depends_on` may under-cascade. Consider `release: minor [model-a, model-b]` in trailer for scoped bumps.
