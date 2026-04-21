# Canary E2E Audit — 2026-04-20

End-to-end dogfood of `putitoutthere` against live registries (crates.io, PyPI, npm) via the `piot-fixture-zzz-*` canary family. This audit covers a ~4-hour debugging session on 2026-04-20 that landed two of three registries and catalogues the remaining blockers.

## TL;DR

- **crates.io**: `piot-fixture-zzz-rust@0.0.1776663346` ✓ live
- **PyPI**: `piot-fixture-zzz-python@0.0.1776663346` ✓ live (first publish; OIDC trusted publishing)
- **npm**: `piot-fixture-zzz-cli` — still 404, blocked at auth

## Bugs fixed this session

| # | PR | Symptom | Root cause | Fix location |
|---|----|---------|-----------|-----|
| 1 | [#84](https://github.com/thekevinscott/put-it-out-there/pull/84) | Post-merge E2E aborted at completeness check, never touching any registry. | E2E harness built a fixture repo but never staged artifacts; `src/completeness.ts` requires `{cwd}/artifacts/{name}-{target}/` for crates + pypi rows. | `test/e2e/harness.ts:108-142` (`stageArtifacts()`), `.github/workflows/e2e.yml:45-60` (Python + build/twine). |
| 2 | [#85](https://github.com/thekevinscott/put-it-out-there/pull/85) | `Cargo.toml not found at rust/Cargo.toml` even though the file existed. | Handlers do `readFileSync(join(pkg.path, 'Cargo.toml'))`, which resolves relative `pkg.path` against `process.cwd()` — not `opts.cwd`. Self-publish accidentally worked because `process.cwd() === opts.cwd`; any caller using `--cwd /elsewhere` (e2e harness, monorepo orchestrators) broke. | `src/publish.ts:54-57` — absolutize every `pkg.path` against `opts.cwd` at the top of `publish()`. |
| 3 | [#86](https://github.com/thekevinscott/put-it-out-there/pull/86) | `pypi: PYPI_API_TOKEN not set` even though the workflow declared `id-token: write`. | PyPI handler only honored an explicit token. Modern PyPI publishes use trusted publishing via OIDC (no long-lived token). Empty-string `PYPI_API_TOKEN` also shadowed the OIDC env. | `src/handlers/pypi.ts` — `mintOidcToken()` does the dance (`ACTIONS_ID_TOKEN_REQUEST_URL?audience=pypi` → POST JWT to `https://pypi.org/_/oidc/mint-token` → short-lived token as `TWINE_PASSWORD`). `nonEmpty()` treats `""` as unset. |

## Why it took ~4 hours

These bugs **cascaded** — each was blocking the one behind it:

```
completeness check blocks  →  path bug blocks  →  PyPI auth blocks  →  npm not yet reached
        (#84)                      (#85)               (#86)                 (???)
```

Each cycle was: detect → fix + test → PR → CI gates → merge → push-to-main run → observe next failure. Minimum cycle time ~25-40 min; three cycles.

Compounding friction:

- **The pipeline only exposes the *first* failure.** A three-deep bug stack required three sequential runs to unmask.
- **`require-tests` gate** forced adding a unit test alongside each `src/` change.
- **`dist-action/ is up to date` gate** required `pnpm run build:action` after each `src/` fix to regenerate the bundled GitHub Action.
- **PyPI error message was misleading.** "PYPI_API_TOKEN not set" sent me hunting for secrets configuration when the real gap was an OIDC exchange.
- **No post-merge CI webhook.** PR webhooks cover PR-scoped checks only; to see the push-to-main E2E outcome I had to WebFetch the Actions HTML (timestamps hidden, pagination stubbed).

## npm current failure — resolved

**Root cause**: `test/e2e/canary.e2e.test.ts:85` read `process.env.NPM_TOKEN`, but `.github/workflows/e2e.yml:100` exposes the secret as `NODE_AUTH_TOKEN` (the `actions/setup-node@v4` convention). The `?? ''` fallback passed an empty string to `runPiot`, whose `{ ...process.env, ...env }` spread overwrote the real token the CLI would have inherited. `npm publish` saw no auth → `need auth` error.

Crates + PyPI were unaffected because their env var names (`PYPI_API_TOKEN`, `CARGO_REGISTRY_TOKEN`) match across workflow and test.

Fixed in #96 (one-character change). Tracked issue #95 captures the broader concern: the npm handler's preflight should accept both `NODE_AUTH_TOKEN` and `NPM_TOKEN` so adopters who expose the secret under the name `NPM_TOKEN` at the step level don't get a misleading preflight error.

### Diagnostic detour

Before finding the actual cause, I hypothesized two wrong things:

1. `NPM_TOKEN` secret missing from the `e2e` environment. (User confirmed it was set.)
2. `setup-node`'s `.npmrc` location being unreachable from the temp cwd. (Wrong — `setup-node@v4` writes to `$RUNNER_TEMP/.npmrc` and exports `NPM_CONFIG_USERCONFIG`, so npm finds it from any cwd.)

Both were plausible given the error message; neither were the actual bug. A `preflight --all` that reported "NODE_AUTH_TOKEN present in env = true" would have short-circuited this detour immediately.

## Catalogue — generalized issues for future libraries

Issues any library adopting `putitoutthere` would hit:

1. **`pkg.path` resolution against `process.cwd()`.** Fixed in #85. Worth a regression test that *spawns the CLI binary* (not just calls `publish()`) to catch future regressions of the same shape.
2. **Artifact naming contract is invisible.** The `§12.4`-style directory convention (`{pkg.name}-{target}`) only lives in plan.md. The completeness error message should print the expected layout (`expected: artifacts/foo-wheel-linux/`). Consider a `putitoutthere doctor` subcommand that validates layout.
3. **PyPI trusted-publishing happy path is undocumented.** The handler error should say "set `PYPI_API_TOKEN` **or** enable trusted publishing with `id-token: write` permission" so users don't hunt for missing secrets.
4. **npm trusted-publishing bootstrapping.** The chicken-and-egg problem (package must exist before trusted publishing works) is documented in `e2e.yml` comments but not surfaced in the handler. A friendlier bootstrap error would save debugging time.
5. **Empty-string env vars masking OIDC.** Fixed for PyPI in #86. `src/handlers/npm.ts:107` uses `??` which won't fall through for `""` either. Worth auditing `src/handlers/crates.ts` for the same pattern.
6. **Cascade failure visibility.** Each fix required a full CI round-trip to see the next problem. A `putitoutthere preflight --all` that dry-runs completeness + auth + path resolution against every package would collapse three round-trips into one.
7. **`require-tests` + `dist-action` friction.** Good guardrails, but they double the cycle time for every tight-loop fix. An explicit `--skip-gates` escape hatch for clearly-marked fixup commits might be worth the tradeoff.

## Proposed next steps

- **Immediate**: confirm `NPM_TOKEN` is set in the `e2e` GitHub Environment. If not, bootstrap with a publish token so the first `piot-fixture-zzz-cli` canary lands.
- **Short-term**: file issues #2-#7 above as tracked tickets so they don't get lost.
- **Medium-term**: implement `putitoutthere preflight --all` (item #6) — this is the single highest-leverage fix for iteration speed during onboarding new libraries.
