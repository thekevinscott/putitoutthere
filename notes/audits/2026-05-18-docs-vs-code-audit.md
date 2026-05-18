# Docs-vs-code audit — 2026-05-18

Audit walks every consumer-observable claim in `README.md` and the
internal docs under `notes/` and asks whether the actual code on this
SHA still backs them. The truth ranking, per the prompt that opened
this audit, is: code first, `README.md` second, everything else under
suspicion.

The bar for "drift" here is _consumer-observable_: a doc claim that
would mislead a consumer writing a workflow against `@v0` today. Wording
nits are out of scope; behavior, defaults, error codes, schema fields,
and workflow inputs/outputs are in scope.

## Summary

Nine findings. Two are clear doc bugs that should be fixed under
a follow-up (1, 2). The rest are smaller documentation gaps.

Two earlier findings (artifact-contract.md `download-artifact@v4`,
upstream-behaviors.md npm-repository layering) were retracted on a
second read — the docs already match the code on both. Methodology
note: the initial pass leaned on a fast-pass exploration agent for
breadth; both retractions were claims that agent surfaced without me
re-reading the source file. Subsequent findings were verified by hand
before being recorded.

| # | Severity | Where                                              | What                                                                                             |
|---|----------|----------------------------------------------------|--------------------------------------------------------------------------------------------------|
| 1 | High     | `README.md:254`                                    | PyPI `build` field claimed "Required" — code defaults to `"setuptools"`.                          |
| 2 | High     | `src/handlers/pypi.ts:117`                          | CLI guidance suggests `SETUPTOOLS_SCM_PRETEND_VERSION_FOR_<SUFFIX>` which README+workflow flag as broken. |
| 3 | Medium   | `README.md` (error-code listings)                   | Three consumer-visible error codes are emitted but undocumented.                                 |
| 4 | Medium   | `README.md:281,282`                                 | npm `access` / `tag` defaults documented as schema defaults; code applies them at handler time.   |
| 5 | Medium   | `README.md` Trailer section                         | Three behaviors implemented but not documented (case-insensitive, indented, empty `[]` list).    |
| 6 | Low      | `README.md` `check.yml` description                 | `check.yml` hardcodes Node 24; `build.yml`/`release.yml` accept `node_version`. Undocumented asymmetry. |
| 7 | Low      | `notes/4-17-2026-initial-plan/INSTRUCTIONS.md`      | Pre-rewrite plan; architecture description no longer matches the engine.                         |
| 8 | Info     | `action.yml`                                        | Doc/code accurate; flagged here only so future doc work tracks the `node24` runtime.             |
| 9 | Info     | `README.md` Recipes / multi-mode validation         | All four validation rules in README match `src/config.ts` 1:1. No drift; recorded for next audit.|

## Findings

### 1. PyPI `build` field documented as "Required" but defaults to `setuptools`

`README.md:251-256`:

```
### `kind = "pypi"`

| Field        | Type                   | Notes                                              |
|--------------|------------------------|----------------------------------------------------|
| `pypi`       | string                 | Override `name` → PyPI registered name.            |
| `build`      | enum                   | `maturin` \| `setuptools` \| `hatch`. Required.    |
```

`src/config.ts:156`:

```ts
build: PYPI_BUILD.default('setuptools'),
```

The schema does not require `build` for pypi packages — omitting it
silently selects `setuptools`. Consumers reading the README table will
think the key is mandatory. The README's "If a Python package can't fit
any of these three shapes, it's outside putitoutthere's scope" wording
at `README.md:774` is consistent with `setuptools` being the implicit
default, but the field table contradicts it.

**Fix shape:** change the cell to "Optional. Default `setuptools`." and
move the "Required" cell to a separate column or footnote so the rest
of the kind tables stay self-consistent. Crates and npm `build` are
both optional in the schema, so they line up.

### 2. CLI suggests an SCM env-var form the rest of the system rejects

`src/handlers/pypi.ts:113-121` emits user-facing guidance for the
`write-version` path when a pypi package is dynamic-versioned:

```ts
ctx.log.info(
  [
    `${who}: detected dynamic version; nothing to rewrite in pyproject.toml.`,
    `  Planned version: ${version}. Pass it to the build backend via one of:`,
    `    - SETUPTOOLS_SCM_PRETEND_VERSION_FOR_${envSuffix}=${version}  (hatch-vcs / setuptools-scm)`,
    ...
  ].join('\n'),
);
```

But `README.md:758-761` is explicit:

> The reusable workflow sets `SETUPTOOLS_SCM_PRETEND_VERSION` on the
> build step to the planned version, which `hatch-vcs` honors.
> Per-package variants like `SETUPTOOLS_SCM_PRETEND_VERSION_FOR_<PKG>`
> are silently ignored by `hatch-vcs`; only the global form works.

And `.github/workflows/_matrix.yml:308-316`:

```yaml
# hatch-vcs / setuptools-scm derive the version from the latest git
# tag at build time ... Per-package variants are silently ignored by
# hatch-vcs; only the global one works.
env:
  SETUPTOOLS_SCM_PRETEND_VERSION: ${{ matrix.version }}
```

A consumer who reads the engine's stdout guidance, copies the
`SETUPTOOLS_SCM_PRETEND_VERSION_FOR_<SUFFIX>` form into their own job,
and uses `hatch-vcs` will silently ship the wrong version — exactly
the failure mode the design-commitments doc calls out
("no release surprises").

**Fix shape:** drop the `_FOR_<SUFFIX>` line from the info message in
`src/handlers/pypi.ts:117`, or replace it with the unsuffixed form +
a note about `hatch-vcs`'s scoping limitation. Either way the CLI
output should match what the build job actually sets.

### 3. Undocumented consumer-visible error codes

`src/error-codes.ts` defines 14 codes. The README surfaces 11 of them
in `kind`-specific tables. The other three:

- `PIOT_AUTH_NO_TOKEN` (`src/error-codes.ts:24`)
- `PIOT_PUBLISH_EMPTY_PLAN` (`src/error-codes.ts:32`)
- `PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED` (`src/error-codes.ts:112`)

`PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED` is the one a consumer is most
likely to hit in the wild: it fires on the very first crates.io publish
when Trusted Publishing is registered but the crate has never been
published. The README's `### crates.io` section discusses the bootstrap
flow in prose but does not name the error code, so a consumer grepping
the run log for `PIOT_...` lands on no documentation.

`PIOT_AUTH_NO_TOKEN` and `PIOT_PUBLISH_EMPTY_PLAN` are architectural-
edge failures the reusable workflow's gates should prevent. The
inline JSDoc for `PUBLISH_EMPTY_PLAN` says as much:
"The reusable workflow's gate should prevent this from being reached;
if it fires, the gate was bypassed or the engine is inconsistent."
Defensible to leave undocumented, but a "Diagnosing errors" section in
the README would make these greppable from the code-side without
requiring a source read.

**Fix shape:** add a `## Error codes` section to the README that
enumerates every code in `error-codes.ts` with a one-line "what trips
this" and a pointer to the recipe that resolves it. This is also what
the inline doc-comment in `src/error-codes.ts:1-8` claims the codes
exist to support ("the docs site deep-linking from a code to a
recipe") — the deep-link target needs to actually exist.

### 4. Schema defaults documented as if they were schema defaults

`README.md:281-282`:

```
| `access`  | enum                   | `public` \| `restricted`. Default `public`.    |
| `tag`     | string                 | dist-tag. Default `latest`.                    |
```

`src/config.ts:264-265`:

```ts
access: z.enum(['public', 'restricted']).optional(),
tag: z.string().optional(),
```

Neither field carries a Zod `.default(...)` — they're `.optional()`.
The defaults are applied at the handler:

- `src/handlers/npm.ts:146`: `const access = pkg.access ?? 'public';`
- `src/handlers/npm.ts:148`: `if (pkg.tag) args.push(\`--tag=${pkg.tag}\`);`
  (no explicit fallback; the npm CLI's own default is `latest`)

Consumer-observable behavior matches the README, so this is not a bug
in the sense that anyone gets the wrong publish. It's a minor
internal inconsistency: a "where do defaults live" reader would
expect `src/config.ts` to be the source of truth. Either move the
defaults into the schema (cheaper to test) or leave a comment on the
handler-side that the README contract is intentional.

### 5. Undocumented trailer flexibility

`src/trailer.ts` accepts three forms the README does not document:

- **Case-insensitive key.** `src/trailer.ts:34` uses the `/i` flag, so
  `RELEASE:`, `Release:`, and `release:` all match. `src/trailer.test.ts:76-79`
  asserts this explicitly.
- **Leading indentation.** `src/trailer.ts:32-33` allows `^\s*release`,
  so indented trailers (`  release: minor`) are valid. `src/trailer.test.ts:162-171`
  covers it.
- **Empty package list.** `release: minor []` is accepted by
  `src/trailer.ts:89` as equivalent to `release: minor` (no packages
  scoped). `src/trailer.test.ts:71` covers it.

None of these mislead consumers — the documented forms still work.
But the engine is slightly more permissive than the docs claim, so a
consumer reviewing a teammate's commit and seeing an indented `Release:
minor` could reasonably think it's broken when it isn't.

**Fix shape:** either tighten the parser to match the docs (case-
sensitive, no leading whitespace, no empty list) or add a one-line
"these forms also work" footnote to `README.md` Trailer section. The
parser's leniency was deliberately added (per the test comment "be
lenient"), so a doc-only fix is appropriate.

### 6. `check.yml` hardcodes Node 24 with no consumer override

`README.md:84-117` describes `check.yml` as the cheap PR-time
config-validation gate. The README does not document any inputs for
this workflow, and the file matches: `on: workflow_call: {}` —
zero inputs.

`.github/workflows/check.yml:54-55`:

```yaml
- uses: actions/setup-node@v6
  with:
    node-version: '24'
```

Hardcoded. `build.yml` and `release.yml` both expose `node_version`
as a `workflow_call` input. The asymmetry is probably deliberate
(`check.yml` runs the engine, not the consumer's build), but a
consumer porting from `release.yml`'s `with: { node_version: '22' }`
might assume the same key works on `check.yml`.

**Fix shape:** one-line addition to the `check.yml` consumer-template
block in the README: "No inputs — Node version is fixed because
`check.yml` does not run consumer build steps." Or expose the input
for parity if there's a future use case.

### 7. `4-17-2026-initial-plan/` describes a different architecture

Per `AGENTS.md`, `notes/migrations-pre-rewrite/` is explicitly stale.
`notes/4-17-2026-initial-plan/` is not flagged, but
`INSTRUCTIONS.md:1-11` describes versioning as "a commit produces a
new patch version" — the current architecture is glob-based cascade
with explicit `[[package]]` entries and tag-derived versions, not
per-commit auto-versioning.

This won't mislead a consumer (they don't read it) but does mislead
new contributors reading `notes/` for orientation.

**Fix shape:** move into `notes/migrations-pre-rewrite/` or annotate
the dir with a top-level `STALE.md` describing what supersedes it.

### 8. `action.yml` (informational, no drift)

`action.yml` documents `node24` runtime and `command` /
`working_directory` / `version` inputs that map 1:1 to
`src/cli-bin.ts`. The action is correctly described as
internal-only (`notes/design-commitments.md` non-goal #10). No
drift; recorded for future doc audits so this stays on the radar.

### 9. Multi-mode npm validation (informational, no drift)

`README.md:649-654` enumerates four validation rules for the npm
multi-mode `build` array:

1. Each mode appears at most once.
2. Every `name` template must contain `{triple}`.
3. Unknown placeholders are rejected.
4. All entries must produce distinct platform-package name templates.

`src/config.ts:271-322` implements all four — `seenModes`,
`validateNameTemplate`, `NPM_NAME_TEMPLATE_VARS`, `seenTemplates`.
The variable list (`name`, `scope`, `base`, `triple`, `mode`) matches
`README.md:631-636` exactly. No drift; recorded so the next audit
can skip it.

## Spot checks that passed (no findings)

The following claims were verified end-to-end and need no fix:

- All 11 README-claimed error codes (`PIOT_CRATES_*`, `PIOT_PYPI_*`,
  `PIOT_NPM_MISSING_REPOSITORY`) exist in `src/error-codes.ts` and
  are emitted from both `src/preflight.ts` (publish-time) and
  `src/check.ts` (PR-time).
- `release.yml` inputs (`environment`/`node_version`/`python_version`)
  and defaults (`release`/`24`/`3.12`) match the README's `Optional
  inputs` table.
- `release.yml` secrets (`CARGO_REGISTRY_TOKEN`, `NPM_TOKEN`) are
  optional, and both `secrets: required: false` and the gating
  shell-level `if:` conditions match the prose in
  README → "Trusted publishers".
- `release.yml` output `has_pypi` is plumbed through
  `_matrix.yml` and consumed by the documented `pypi-publish` job.
- `check.yml` and `build.yml` carry `permissions: contents: read`
  only — no `id-token: write` on either path, matching the
  structural-safety claim in README.
- `release.yml:267-285` creates GitHub Releases for new tags via
  `gh release create ... --generate-notes`, exactly as the README
  prose at lines 51-55 promises.
- Default `tag_format` is `{name}-v{version}`
  (`src/tag-template.ts:20`, matching `README.md:221`).
- Both `isPublished` skip paths exist (`src/handlers/crates.ts:42`,
  `src/handlers/npm.ts:48`, `src/handlers/pypi.ts:149`), matching
  the "Each handler's first move on publish is `isPublished`"
  claim at `README.md:399-400`.
- The four "schema gotchas" in `README.md:170-178` are all detected
  by `detectCommonMistakes` in `src/config.ts:430-461` with the
  exact wording the README promises.
- Trailer grammar (`patch`/`minor`/`major`/`skip`, optional package
  list, last-wins semantics) matches `src/trailer.ts` exactly.
- Cascade cycle detection at config-load (`src/cascade.ts:97-98`)
  and duplicate-name guard (`src/config.ts:467`) both exist as
  promised.
- Empty-globs check at PR time (`src/check.ts:162-167`) exists.
- Tag-format collision check at PR time (`src/check.ts:184-198`)
  exists.
- `bundle_cli` constraint matrix (pypi: requires `maturin` +
  non-empty `targets`; npm: requires `bundled-cli` mode + non-empty
  `targets`) matches `src/config.ts:160-179` and `:330-353`.
