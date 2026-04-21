# Evaluation: piot for dirsql's release machinery

Based on piot's docs, migration audits (`migrations/PLAN_GAPS.md`, `migrations/gbnf.md`, `migrations/skillet.md`, `migrations/curtaincall.md`, `migrations/cachetta.md`), and the actual handler source (`src/handlers/*.ts`), here is my assessment.

## 1. What piot already supports well

Concrete matches for dirsql, with evidence:

- **Trailer-driven bump + per-package tags.** `release: patch|minor|major|skip` on the merge commit replaces `patch-release.yml`'s manual orchestration. Tags collapse to uniform `{name}-v*`. Scoped trailers (`release: patch [dirsql-py]`) already work (PLAN_GAPS, gbnf.md §"Per-package cadence preserved via scoped trailers").
- **Cross-language `depends_on` cascade.** PLAN_GAPS row "Cross-language `depends_on` cascade — Supported". Exactly the shape dirsql needs: a Rust core change triggers crates + PyPI + npm bumps in lockstep.
- **OIDC on all three registries, no tokens.** README confirms npm trusted publishing with automatic `--provenance`, PyPI trusted publisher, and crates.io via `rust-lang/crates-io-auth-action`. Your `NPM_TOKEN` legacy path is explicitly obsolete under piot.
- **Maturin wheel matrix.** PLAN_GAPS: "Rust → Python wheels via maturin, 5-target matrix — Supported." This is directly your PyO3 story.
- **npm family pattern (`@dirsql/cli-*`, `@dirsql/lib-*` + top-level with `optionalDependencies`).** `src/handlers/npm-platform.ts` synthesizes per-platform sub-packages, publishes each with narrowed `os`/`cpu`, rewrites the top-level `package.json`'s `optionalDependencies`, and publishes it last. Ordering is safety-first: platform publish failure short-circuits before the top-level goes out. Scoped names (`@scope/`) are supported (PLAN_GAPS).
- **Partial-failure discipline aligned with your operational lesson.** PLAN_GAPS, "Auto tag-rollback on publish failure — Intentionally not supported; completeness-check (plan.md §13.2) prevents the partial-publish class that made rollback necessary." This matches dirsql's invariant: never delete a tag once crates.io has accepted it.
- **GitHub Release creation** (plan.md §15, per PLAN_GAPS reference).
- **Cadence modes** (`immediate`, `scheduled`) cover both your current manual orchestrator and any future cron.

Net: most of the structural rewiring is already there. The 5 workflows collapse to 2 (`release.yml` + `putitoutthere-check.yml`), matching every audited sibling repo.

## 2. Gaps that block adoption or need changes to piot itself

Specific, evidence-backed blockers:

1. **No aarch64-linux runner-selection primitive.** This is the biggest operational gap for dirsql. Your v0.2.0 incident was `aarch64-unknown-linux-gnu` failing on `ubuntu-latest`; the fix required a native `ubuntu-24.04-arm` runner. Nothing in piot's handler source, PLAN_GAPS, or the audited migration docs shows a per-triple `runner = ...` config or a built-in default that picks ARM runners for ARM Linux targets. Without it, piot's generated `release.yml` will re-introduce the exact class of bug you already hit.

2. **npm-platform handler is publish-only, not build.** Despite PLAN_GAPS listing "Rust → npm via napi-rs / bundled-cli — Supported," `src/handlers/npm-platform.ts` explicitly "does not build napi-rs or Rust artifacts — it assumes compiled binaries already exist in an artifacts directory." The matrix that actually cross-compiles the 10 `.node` + CLI binaries for dirsql's family is still hand-rolled in `release.yml`. "Supported" here means "piot won't trip over the family once you've built it," not "piot generates the cross-compile matrix for you." Same observation applies to the pypi handler: it's publish-only and scans `ctx.artifactsRoot` for `.whl`/`.tar.gz`.

3. **No standalone archive assets on GitHub Release (cargo-dist replacement).** PLAN_GAPS names this as Gap #1 and explicitly references dirsql's migration doc: "Putitoutthere creates GitHub Releases (plan.md §15) but doesn't attach standalone archive assets for non-`bundled-cli` handlers." Your `release.yml` today ships curl-installable `.tar.xz` archives via cargo-dist. Adopting piot without closing this gap means a regression for any consumer currently doing `curl | tar x`.

4. **Long-tail target triples are a fallthrough.** `targetToOsCpu` falls through for `i686-*`, `armv7-*`, and — per PLAN_GAPS — there's no explicit-mapping test. dirsql's current matrix is mainstream enough that this probably isn't a blocker today, but it's fragile.

5. **PyPI handler version rewrite is a naive string replace** ("Rewrites the first `version = "x.y.z"` inside the `[project]` table"). Maturin projects typically declare version in `Cargo.toml` and let maturin propagate it; confirm the handler doesn't corrupt a maturin-managed `pyproject.toml` where `version` is dynamic. PLAN_GAPS flags a similar concern for hatch-vcs as a "Verify" item.

6. **Crates feature-gated CLI is unconfirmed.** Your crates.io publish ships `cli` as an opt-in feature. I didn't see evidence in `src/handlers/crates.ts` (not read, but no feature config surfaced in migration docs) that piot's crates handler passes feature flags through. Worth checking — if not, consumers doing `cargo install dirsql --features cli` still works, but piot's own verification step might build without the feature.

7. **No dirsql migration audit exists.** `migrations/dirsql.md` returns 404, yet PLAN_GAPS cites it. Someone (likely Kevin, or this eval) needs to write it; don't cut over without one.

## 3. Primitives to add to piot

Ordered by impact on dirsql specifically:

1. **Per-target `runner` override** (and sensible defaults for `aarch64-unknown-linux-gnu → ubuntu-24.04-arm`, `aarch64-apple-darwin → macos-14`, etc.). This is the single highest-value addition. Without it, piot's generated cross-compile matrix will replay your v0.2.0 failure.

2. **First-class `napi` and `maturin` build modes**, symmetric with the existing `build = "hatch"` / `build = "uv"`. The config should emit the correct `napi build --target <triple>` / `maturin build --target <triple> --release` invocations, the matrix, the runner selection from (1), and the artifact upload contract that `npm-platform.ts` / `pypi.ts` already expect. This turns "Supported" from a structural statement into a generative one.

3. **`[[package.assets]]` primitive for GitHub Release archives.** Triple → archive-name mapping (`dirsql-x86_64-unknown-linux-gnu.tar.xz`) attached to the Release. Closes PLAN_GAPS Gap #1 and preserves cargo-dist behavior. This is a small, well-scoped feature.

4. **Per-registry outcome ledger.** The completeness-check prevents partial publishes prospectively, but when a publish still fails mid-flight, operators need a durable record of "crates: ✓, pypi: ✗, npm: ✓" attached to the tag/Release. This operationalizes your "never delete the tag" lesson and turns a retry into a targeted action rather than archaeology.

5. **Cargo feature passthrough in the crates handler** (`features = ["cli"]` on the crates package). Low effort, directly matches dirsql's existing shape.

6. **Explicit triple mapping with errors on miss** (already on PLAN_GAPS TODO). Turn the fallthrough into a hard "triple X not mapped — specify `runner` and `os`/`cpu` explicitly" so surprises surface at plan time, not mid-publish.

## Bottom line

piot is ~70% of what dirsql needs out of the box: the orchestration spine (trailers, cascade, OIDC, family publishes, completeness-check) is real and tested against sibling repos. The missing 30% is concentrated in **build-side** generation — runner selection, napi/maturin matrix scaffolding, and GH Release archive assets. Those are additive primitives, not architectural shifts; none of them conflict with piot's existing model. I would **not** cut over today, but adoption is a realistic milestone behind items (1)–(3) above, and writing the dirsql audit doc is the right first step.

Sources:
- [put-it-out-there repo](https://github.com/thekevinscott/put-it-out-there)
- [PLAN_GAPS.md](https://raw.githubusercontent.com/thekevinscott/put-it-out-there/main/migrations/PLAN_GAPS.md)
- [gbnf migration](https://raw.githubusercontent.com/thekevinscott/put-it-out-there/main/migrations/gbnf.md)
- [skillet migration](https://raw.githubusercontent.com/thekevinscott/put-it-out-there/main/migrations/skillet.md)
- [curtaincall migration](https://raw.githubusercontent.com/thekevinscott/put-it-out-there/main/migrations/curtaincall.md)
- [cachetta migration](https://raw.githubusercontent.com/thekevinscott/put-it-out-there/main/migrations/cachetta.md)
- [`src/handlers/npm-platform.ts`](https://raw.githubusercontent.com/thekevinscott/put-it-out-there/main/src/handlers/npm-platform.ts)
- [`src/handlers/pypi.ts`](https://raw.githubusercontent.com/thekevinscott/put-it-out-there/main/src/handlers/pypi.ts)
