# Re-audit: `run:` steps hold no logic (#448, epic #442)

Closing pass for epic #442 (worklist item 6). Confirms the epic's bar:
once a repo-internal CI gate's logic lives in `packages/ci`, its workflow
step holds only wiring, and the `test/workflows/` text-contract tier has
shrunk to the invariants that genuinely earn a text test.

## Extracted gates: workflow steps hold no logic

Each extracted gate's step is now `pnpm exec piot-ci <gate>` preceded only
by exempt setup (checkout, `npm install -g pnpm`, `pnpm install`):

| gate | workflow | gate step |
| --- | --- | --- |
| changelog-check (#520) | `changelog-check.yml` | `pnpm exec piot-ci changelog-check` |
| tdd-lint (#523) | `tdd-lint.yml` | `pnpm exec piot-ci tdd-lint` |
| actionlint-idtoken (#523) | `actionlint.yml` | `pnpm exec piot-ci actionlint-idtoken` |
| evidence-check | `evidence-check.yml` | `pnpm exec piot-ci evidence-check` |

The only multi-line `run:` blocks in these files are exempt glue: the
`actionlint` tool download+invocation in `actionlint.yml`, and toolchain
setup. No `case` dispatch, loop, conditional, or `grep`/`sed` text-munging
remains in any extracted gate's step.

## Superseded `test/workflows/` text tests: none left to delete

The text-tests for the extracted subjects were deleted inline with each
extraction, not deferred to this cleanup pass:

- Tag-move / release-github plumbing (items 1–2): `github-release-step.test.ts`
  deleted in #459; `advance-v0.test.ts` and `dogfood-bundle-commit.test.ts`
  deleted in #465.
- The changelog-check / tdd-lint / actionlint-idtoken gates never had a
  `test/workflows/` text test — their behaviour was pinned directly by
  colocated `decide.test.ts` / `run.test.ts` in `packages/ci` (#520, #523).

The 12 `test/workflows/` files that remain are all *earned* per
"Workflow-contract tests are earned": each guards a reviewer-invisible
invariant in the **shipped reusable workflow / action** (not a repo-internal
gate whose logic moved to code):

- `npm-install-fallback` — `strict || lenient` self-heal + `::warning::`.
- `publish-github-token` — `env: GITHUB_TOKEN` presence on publish steps.
- `npm-build-target-env` — `TARGET`/`BUILD` env presence for consumer builds.
- `cargo-cache` — `Swatinem/rust-cache` precedes each cargo cost center.
- `napi-crate-version`, `npm-bundled-cli-crate-version` — `write-crate-version`
  ordering before the compile that bakes `CARGO_PKG_VERSION`.
- `bundle-cli-musl-target` — glibc-floor-avoiding musl substitution.
- `testpypi-e2e` — TestPyPI upload/verify wiring in `e2e-fixture.yml`.
- `action-manifest` — `action.yml` parseability + `runs` entrypoint.
- `dogfood-globs` — every `putitoutthere.toml` glob cascades on touch.
- `workflow-yaml-invariants` — uses-ref pinning, token-secret plumbing,
  build-step ordering, `check.yml` shape + no-`id-token` permission, tarball
  retry.

`evidence-check-workflow.test.ts` is left untouched — the evidence-check
extraction is landing in parallel and owns its own test disposition.

## One remaining non-conforming gate (out of scope for #448)

`patch-coverage.yml` still runs `node .github/workflows/patch-coverage.mjs`
— an authored `.mjs` logic file under `.github/`, contrary to rule 2. It is
a not-yet-extracted gate tracked separately under epic #442; #448 does not
touch it.
