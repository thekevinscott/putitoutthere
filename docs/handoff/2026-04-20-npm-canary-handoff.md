# Handoff — complete the 3-registry canary dogfood

**Date**: 2026-04-20
**Incoming agent**: you
**Outgoing agent**: Claude (session `019gAtCifLd7xCCCfGRpNPZ9`)
**Companion audit**: [`docs/audits/2026-04-20-canary-e2e-audit.md`](../audits/2026-04-20-canary-e2e-audit.md) (also see the PR that adds this handoff)

## The final goal

Get all three `piot-fixture-zzz-*` canaries publishing successfully on every push to `main`. Specifically:

- `piot-fixture-zzz-rust` → **crates.io** — already working ✓
- `piot-fixture-zzz-python` → **PyPI** — already working ✓ (OIDC trusted publishing)
- `piot-fixture-zzz-cli` → **npm** — **not yet working** ← your job

The long-term objective behind this canary: `putitoutthere` should publish any library to any of the three registries out of the box, with OIDC-first authentication and token fallbacks. The canary family is the e2e witness that this works end-to-end without manual intervention.

## What's been done

See the full audit for context. High-level summary of PRs landed this session:

- **[#84](https://github.com/thekevinscott/put-it-out-there/pull/84)** — `stageArtifacts()` in the e2e harness runs real `cargo package` + `python -m build --sdist` so the completeness check stops aborting the pipeline.
- **[#85](https://github.com/thekevinscott/put-it-out-there/pull/85)** — `src/publish.ts` absolutizes every `pkg.path` against `opts.cwd` at the top of `publish()`. Fixes `Cargo.toml not found at rust/Cargo.toml` when the CLI is invoked from a directory other than the repo root.
- **[#86](https://github.com/thekevinscott/put-it-out-there/pull/86)** — `src/handlers/pypi.ts` does the PyPI trusted-publishing OIDC exchange (audience=pypi → mint-token). Also treats empty-string `PYPI_API_TOKEN` as unset.

Verified live on registries as of 2026-04-20 06:55 UTC:

- crates.io: `piot-fixture-zzz-rust@0.0.1776663346`
- PyPI: `piot-fixture-zzz-python@0.0.1776663346`

## What remains

### 1. Confirm + fix the npm publish failure (primary)

Most recent post-merge E2E run failed at:

```
npm error need auth  This command requires you to be logged in to https://registry.npmjs.org/
```

**Start here** (in order):

1. Run `gh run list --workflow=e2e.yml --branch=main --limit 10` to find the most recent E2E run on main and get its timestamp.
2. Run `gh run view <run-id> --log-failed` on the most recent failing run. Confirm the exact step + stderr for the npm failure.
3. Run `gh secret list --env=e2e --repo=thekevinscott/put-it-out-there` to see whether `NPM_TOKEN` is configured in the `e2e` environment. (The repo scope MCP tool the previous agent had access to couldn't see environment secrets.)
4. If `NPM_TOKEN` is absent: generate an npm automation token scoped to `piot-fixture-zzz-*` (ideally), add it to the `e2e` environment as `NPM_TOKEN`, trigger a fresh run with `gh workflow run e2e.yml --ref=main -f publish=true`, and verify the canary lands at `https://registry.npmjs.org/piot-fixture-zzz-cli`.
5. If `NPM_TOKEN` is present but still failing: check whether the token was invalidated, whether `//registry.npmjs.org/:_authToken` makes it into `.npmrc` (add `cat ~/.npmrc` to the workflow temporarily), and whether the `piot-fixture-zzz-*` scope is covered by the token's publish permissions.

**Watch out for** the npm trusted-publishing bootstrap paradox: npm's trusted publishing requires the package to already exist on the registry. So the first canary publish *must* go through a token. After the first publish, you can re-evaluate whether to register a trusted publisher on npmjs.org and let the OIDC path take over.

### 2. File tracked issues for the generalized gaps

The audit lists 7 generalized issues (items #1-#7 in the "Catalogue" section). These aren't blockers for the dogfood, but they would bite any library adopting `putitoutthere`. Open a GitHub issue for each — suggest grouping them under a milestone like "Onboarding polish." Particularly high leverage:

- **Item #6 — `putitoutthere preflight --all`**: would collapse the 3-cycle cascade debugging loop to one cycle. Highest ROI.
- **Item #2 — better completeness error messages**: every new adopter will hit this.
- **Item #5 — `??` vs `??` with empty string in npm/crates handlers**: same class of bug as the one #86 fixed for PyPI. Audit and fix proactively.

### 3. Close the Actions-timestamps gap (nice to have)

I lost visibility into which workflow run produced the successful rust+python canaries at 06:55 UTC, because the Actions listing via WebFetch hides absolute timestamps. You have the `gh` CLI — use it. Document what you find in a comment on the PR that lands this handoff, so future debugging doesn't have to rediscover it.

## Repo context you'll need

- **Branch policy**: develop on feature branches, push with `-u origin <branch>`, open PRs via `gh pr create`. Auto-merge with squash enabled on this repo.
- **CI gates**: every `src/` change needs a matching `*.test.ts` change (`require-tests` gate) and a rebuilt `dist-action/` bundle (`pnpm run build:action`). See the audit for full list.
- **Key files**:
  - `.github/workflows/e2e.yml` — the only workflow that actually publishes to live registries on push-to-main.
  - `src/handlers/npm.ts` — the handler you'll be staring at.
  - `src/handlers/pypi.ts` — freshly landed in #86; mirror its OIDC approach if you extend npm's OIDC handling.
  - `test/e2e/harness.ts` — `stageArtifacts()` lives here; npm is exempt because vanilla mode publishes from the source tree.
  - `test/fixtures/e2e-canary/putitoutthere.toml` — the canary fixture config; `piot-fixture-zzz-cli` is kind `npm` with `path = "npm"`.
- **Session summary of prior work**: `/root/.claude/projects/-home-user-put-it-out-there/8e308c9b-d6f4-4c21-93fe-b83f88a4eecb.jsonl` (if you have local FS access).

## Operational notes from the outgoing agent

- **The user wants accountability polling.** Set recurring status checks (hourly or better) — the user called this out explicitly when a background watcher went silent. `/loop 10m <check>` is the right primitive if `CronCreate` is available in your environment.
- **Treat registry HTTP status as the source of truth**, not workflow conclusions. E2E runs can fail at step N after successfully publishing at step N-1; the run shows as "failed" but some canaries are already live. `curl -sI https://registry.npmjs.org/piot-fixture-zzz-cli` answers "is it published?" in one call.
- **PR webhooks don't cover push-to-main runs.** If you want to watch for post-merge outcomes, either subscribe the Actions HTML or use `gh run watch`.

Good luck — you're one auth config away from the green flag.
