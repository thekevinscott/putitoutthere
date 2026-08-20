# Upstream registry behaviours we depend on

Catalogue of registry-side response shapes and auth flows that
`putitoutthere`'s handlers parse, recognise, or architecturally avoid.
Each entry below points at:

1. A captured response fixture under
   [`tests/integration/fixtures/registry-responses/`](../packages/engine/tests/integration/fixtures/registry-responses/),
2. The integration test that replays it
   ([`tests/integration/registry-auth.integration.test.ts`](../packages/engine/tests/integration/registry-auth.integration.test.ts)),
3. The engine code path that reacts.

When a fixture's shape drifts — a registry tweaks an error code, a CLI
reformats its stderr block, a `repository_owner`-filter quirk changes —
update the fixture, update the catalogue row, and update the test that
asserts the engine's reaction. The catalogue is the institutional
memory; the fixtures and tests are the executable record.

## Why catalogue at all

Most of these behaviours are *architectural*: the engine decides
nothing about npm provenance because PyPI rejects reusable-workflow
mints; the engine does decide to surface a CARGO_REGISTRY_TOKEN hint
because crates.io's TP couples to a previously-published crate. Both
shapes live in scattered comments today — issue threads, audit docs,
error-code definitions, handler-level prose. This file is the single
grep-able answer to "which upstream quirk forced that bit of engine
code?".

Adding a new row: add the fixture, write the test that replays it,
then describe the contract here.

## Catalogue

### crates.io

#### `crates-io/publish-first-publish-tp-rejected.txt` — #284

**Shape.** `cargo publish` exits non-zero with stderr containing:

```
error: failed to publish to registry at https://crates.io

Caused by:
  the remote server responded with an error (status 404 Not Found):
  Crate `<name>` does not exist or you do not have permission to
  publish to it. Trusted publishing requires the crate to already
  exist. See https://crates.io/docs/trusted-publishing
```

**Trigger.** crates.io's Trusted Publishing feature binds to an
already-published crate name. The OIDC token mint succeeds and the
exchanged short-lived `CARGO_REGISTRY_TOKEN` reaches cargo, but the
registry rejects the publish because there is no crate of that name
yet to match the TP record against.

**Engine reaction.** `matchFirstPublishTpRejection` in
[`src/handlers/match-first-publish-tp-rejection.ts`](../packages/engine/src/handlers/match-first-publish-tp-rejection.ts) anchors on the
404-status line plus the registry's prose. When it fires (outside the
e2e seam — the alt-registry `PIOT_CRATES_REGISTRY_PRIMARY` doesn't
model TP), the handler throws `PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED`
with a bootstrap hint pointing at the classic `CARGO_REGISTRY_TOKEN`
fallback.

**Test.** `crates.io: OIDC TP first-publish rejection (#284)` —
asserts the error code, the CARGO_REGISTRY_TOKEN mention, and a
negative case (generic cargo failures fall through to the existing
"cargo publish failed" message).

### npm

#### `npm/publish-e403-over-publish.txt` — #281

**Shape.** `npm publish` exits non-zero with stderr containing:

```
npm error code E403
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/<name>
  - You cannot publish over the previously published versions: <ver>.
```

**Trigger.** npm CLI retries `PUT /<name>` on transient network errors
(timeout, 502, connection reset). If the first PUT actually succeeded
but the registry's ACK got lost on the wire, the retry lands on a
registry that already has the version and gets E403. The package is
on the registry — npm just exits non-zero on the duplicate write.

**Engine reaction.** `looksLikePublishOverRace` in
[`src/handlers/npm-platform.ts`](../packages/engine/src/handlers/npm-platform.ts)
(re-used by [`src/handlers/npm.ts`](../packages/engine/src/handlers/npm.ts))
short-circuits to `{ status: 'already-published' }`. The first
attempt succeeded; surfacing the E403 as failure would cause a
misleading red release.

**Test.** `npm: E403 over-publish race (#281)`.

#### `npm/publish-422-missing-repository.txt` — #281

**Shape.** `npm publish --provenance` exits non-zero with stderr
containing:

```
npm error code E422
npm error 422 422 Unprocessable Entity - PUT
  https://registry.npmjs.org/<name> - provenance requires a non-empty
  `repository` field in package.json...
```

**Trigger.** npm provenance requires `package.json` to declare a
non-empty `repository` field so the registry can verify the artifact
was built from the repo the trusted publisher declares. The registry
returns 422 — but only after the build job has produced an artifact,
wasting the entire publish run on a precondition checkable in
milliseconds against the consumer's working tree.

**Engine reaction.** Preflight, not response-parsing.
`assertRepositoryField` in
[`src/handlers/npm.ts`](../packages/engine/src/handlers/npm.ts) and the
`requireProvenanceMetadata` preflight gate (#280) reject locally with
`PIOT_NPM_MISSING_REPOSITORY` before any subprocess runs. The
fixture documents what would happen if the local guard were
bypassed; it is not parsed at runtime.

**Test.** `npm: provenance requires non-empty repository (#281)` —
asserts the preflight throws and that `npm publish` is never invoked.

#### `npm/publish-e403-name-too-similar.txt` — #617

**Shape.** `npm publish` exits non-zero with stderr containing:

```
npm error code E403
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/<name> -
  Package name too similar to existing package <other>; try renaming
  your package to '@<scope>/<name>' instead.
npm error 403 In most cases, you or one of your dependencies are
  requesting a package version that is forbidden by your security
  policy, or on a server you do not have access to.
```

npm also ships a plural variant that discloses no blocking package
("too similar to existing packages; try renaming … and publishing with
'--access public' instead"); the two differ only after the prose the
engine anchors on.

Captured from a real `npm publish` (npm 11.17.0) against a registry
returning npmjs.org's documented moniker body — the reporting run's own
stderr was never observed, because the thrown bootstrap error replaced
it. That is the second half of what #617 fixes.

**Trigger.** npm's registry refuses to *create* a name that collapses
onto an existing one: it compares names with punctuation (`-`, `_`, `.`)
stripped and case folded, so a live `will-run` makes `willrun`
unregistrable. Scoped names are exempt. The refusal is a property of the
name, not of the caller — no token and no trusted publisher can get past
it.

Note what is *absent*: the word "name" never appears in the response
code, only in the prose. The refusal is byte-for-byte an ordinary
permission failure as far as any status-code matcher can tell, which is
why the engine misfiled it as one.

**Engine reaction.** `matchNpmNameTooSimilar` in
[`src/handlers/match-npm-name-too-similar.ts`](../packages/engine/src/handlers/match-npm-name-too-similar.ts)
anchors on the prose alone — one anchor, unlike the crates matcher's
pair, because this wording is already unique to the refusal. It is
checked in `publish` **before** the `E404` bootstrap hint below and is
gated on neither OIDC nor the `PIOT_NPM_REGISTRY` override, since an
unregistrable name is a naming problem on any auth path. When it fires
the handler throws `PIOT_NPM_NAME_TOO_SIMILAR` with the rename/scope
remedy and npm's stderr appended.

Ordering is load-bearing. On a first publish this failure satisfies
every condition the bootstrap hint checks — auth-shaped stderr, OIDC in
play, package genuinely absent from the packument — so whichever branch
runs first wins, and the bootstrap hint's advice ("set NODE_AUTH_TOKEN")
is unachievable here.

**Test.** `npm: E403 name-too-similar (the moniker rule) on a first
publish (#617)`, plus the CLI e2e
`tests/e2e/npm-name-collision.e2e.test.ts`, which drives the real npm
binary so the parsed text is npm's own rendering rather than a fixture
string.

#### `npm/publish-e404-unauthorized.txt` — #598

**Shape.** `npm publish` exits non-zero with stderr containing:

```
npm error code E404
npm error 404 Not Found - PUT https://registry.npmjs.org/<name> - Not found
npm error 404  The requested resource '<name>@<ver>' could not be found
  or you do not have permission to access it.
```

Note what is *absent*: no `E401`, no `E403`, no "unauthorized". npm
answers an unauthorized publish with not-found, because confirming a
package exists but is not writable by you is itself an information
disclosure.

**Trigger.** Any publish npm declines to authorize. Two distinct
causes produce byte-identical stderr:

1. **The bootstrap paradox.** npm trusted publishing binds to an
   already-published package, so a consumer's very first publish has no
   OIDC path. The token exchange fails, setup-node's placeholder
   `_authToken` (`XXXXX-XXXXX-XXXXX-XXXXX`) survives in `.npmrc`, and
   the PUT goes out with a bogus bearer.
2. **A transient exchange failure on an existing package.** npm's
   `lib/utils/oidc.js` never throws — every failure path is
   `log.verbose(...); return undefined` — so a network blip or registry
   5xx leaves the same placeholder token in place. Captured verbatim
   from [run 30456638828](https://github.com/thekevinscott/putitoutthere/actions/runs/30456638828),
   which was this case: `0.2.80` of a package published 80 times over.

**Engine reaction.** `looksLikeAuthFailure` in
[`src/handlers/npm.ts`](../packages/engine/src/handlers/npm.ts) matches
the `E404` code, and `isBootstrapPublish` then probes the packument
endpoint to tell the two causes apart. Absent from the registry =>
cause 1, and the engine surfaces the bootstrap hint naming
`NODE_AUTH_TOKEN`. Present => cause 2, and the raw stderr is surfaced
unchanged; claiming "the package does not exist" there would send a
consumer to migrate off trusted publishing for no reason.

Since #617 the hint carries npm's stderr underneath it. The hint reads
the *absence* of the package, never the registry's stated reason, so it
is an inference — and an inference a reader cannot check is one they
cannot correct. The moniker row above is the third cause this same
stderr shape can carry, and it is matched before the hint is reached.

**Test.** `npm: E404 masks unauthorized on a first publish (#598)`.

### PyPI

#### `pypi/oidc-mint-tp-filter-rejected.json` — #252

**Shape.** PyPI's mint-token endpoint (`POST /_/oidc/mint-token` on
warehouse) returns 422 with a JSON body containing
`"code": "invalid-publisher"` and a description naming
`repository_owner` and `job_workflow_ref` claims.

**Trigger.** PyPI's Trusted Publisher matcher filters candidate
publishers by `repository_owner` + `repository_name` *before*
checking `job_workflow_ref`. OIDC tokens minted from inside a
cross-repo reusable workflow always carry the *caller's* repository
slug, so a TP registered against the reusable workflow's repository
is filtered out at the owner-name step before the workflow-ref check
even runs. PyPI documents this at
[pypi/warehouse#11096](https://github.com/pypi/warehouse/issues/11096);
no timeline.

**Engine reaction.** Architectural. The PyPI handler does not call
the mint-token endpoint and does not invoke `twine` /
`pypa/gh-action-pypi-publish` from inside the reusable workflow's
publish job at all. The upload is delegated to a caller-side
`pypi-publish` job that runs in the consumer's own workflow context
(where both `repository` and `job_workflow_ref` align with the
consumer's TP registration). The reusable workflow's responsibility
ends at building artifacts + creating + pushing the git tag.

Background: [`notes/audits/2026-04-28-pypi-tp-reusable-workflow-constraint.md`](audits/2026-04-28-pypi-tp-reusable-workflow-constraint.md).

**Test.** `pypi: OIDC TP filter rejection for reusable-workflow callers (#252)` —
msw's `onUnhandledRequest: 'error'` mode guarantees that an
unexpected POST to a mint or upload endpoint would fail the test.
The handler's `publish` makes exactly one HTTP request (the
`isPublished` GET) and spawns zero subprocesses.

## Adding a new row

1. Capture the response in the wild. Sanitise identifiers (crate
   names, package names, owner slugs) to generic placeholders.
2. Save it under
   `tests/integration/fixtures/registry-responses/<registry>/<descriptive-name>.{txt,json}`.
3. Add an integration test in
   `tests/integration/registry-auth.integration.test.ts` that loads
   the fixture and asserts the engine's reaction.
4. Add a section here covering shape / trigger / engine reaction / test.
5. If the engine added new detection code for this row, reference its
   stable error code in the section.
