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

## npm current failure

Most recent post-merge E2E run ([24650221315](https://github.com/thekevinscott/put-it-out-there/actions/runs/24650221315)):

```
npm error need auth  This command requires you to be logged in to https://registry.npmjs.org/
```

Two plausible causes, neither fully confirmed:

1. **`NPM_TOKEN` secret not present in the `e2e` environment** (most likely). `.github/workflows/e2e.yml:100` reads `secrets.NPM_TOKEN`; no earlier run has successfully published to npm, which suggests the secret was never wired. `actions/setup-node@v4` writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` into `.npmrc`; if `NODE_AUTH_TOKEN` is empty, `npm publish` gets no creds.
2. **npm trusted-publishing bootstrapping paradox.** The workflow comment (`e2e.yml:63-66`) notes that npm's trusted publishing only works *after the package already exists on the registry*. For the first canary publish of `piot-fixture-zzz-cli`, we unavoidably need a token — but it isn't there.

**Unresolved gap:** the successful publishes of `piot-fixture-zzz-rust@0.0.1776663346` (crates.io) and `piot-fixture-zzz-python@0.0.1776663346` (PyPI) both carry a unix timestamp of 06:55:46 UTC. The post-merge E2E run I inspected (run 24650221315) completed at 05:34 UTC. So *some later workflow run* actually produced these publishes, but the Actions listing I could reach via WebFetch didn't surface it (timestamps hidden). A local `gh run list --workflow=e2e.yml --branch=main --limit 20` would close this loop.

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
