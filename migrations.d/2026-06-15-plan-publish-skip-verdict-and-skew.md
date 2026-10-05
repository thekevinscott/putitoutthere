# plan: publish-skip verdict and skew

**Summary.** `putitoutthere plan` now always reports, per planned package,
whether a release from this ref would `PUBLISH` (the version is not yet on
the registry), `SKIP` (already published), or `UNKNOWN` (the registry
couldn't be reached) — and flags **version skew** when a package would
`PUBLISH` while a `depends_on` dependency `SKIP`s. It reuses the real
planner and the same `isPublished` the publish path runs, so the preview
matches reality. Always-on — there is no flag.

**Required changes.** None for consumers of the reusable workflow. The
matrix the workflow consumes (`outputs.matrix`, from the JS action's
`$GITHUB_OUTPUT`) is **unchanged** — a bare array of build rows, byte for
byte. Only a caller that parses `plan --json` **stdout** directly is
affected (see below).

**Deprecations removed.** None.

**Behavior changes without code changes.**

| | Before | After |
|---|---|---|
| `plan --json` stdout | `[ …matrix rows… ]` | `{ "matrix": [ …matrix rows… ], "verdicts": [ … ], "skew": [ … ] }` |
| `plan` human output | matrix rows only | matrix rows + a `publish plan:` section + a `⚠ version skew` line when applicable |
| reusable-workflow `outputs.matrix` | bare array | bare array (unchanged) |

The `matrix` field is identical to the old top-level array; a direct
stdout reader migrates by reading `.matrix`. A registry blip degrades a
verdict to `UNKNOWN` and still emits the matrix — `plan` never aborts on
an unreachable registry.

**Verification.** Run `plan` on a ref where one package's planned version
is already published and a dependent's is not: the published one shows
`SKIP`, the dependent `PUBLISH`, and a `version skew` warning names the
pair. `plan --json` carries the same under `verdicts` / `skew`. The build
matrix (and a real release) are unaffected.
