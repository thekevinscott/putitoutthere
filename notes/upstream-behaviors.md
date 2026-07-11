# Upstream registry behaviours we depend on

Catalogue of registry-side response shapes and auth flows that
`putitoutthere`'s handlers parse, recognise, or architecturally avoid.
Each entry below points at:

1. A captured response fixture under
   [`test/integration/fixtures/registry-responses/`](../packages/engine/test/integration/fixtures/registry-responses/),
2. The integration test that replays it
   ([`test/integration/registry-auth.integration.test.ts`](../packages/engine/test/integration/registry-auth.integration.test.ts)),
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

**Engine reaction.** `looksLikeFirstPublishTpRejection` in
[`src/handlers/crates.ts`](../packages/engine/src/handlers/crates.ts) anchors on the
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
   `test/integration/fixtures/registry-responses/<registry>/<descriptive-name>.{txt,json}`.
3. Add an integration test in
   `test/integration/registry-auth.integration.test.ts` that loads
   the fixture and asserts the engine's reaction.
4. Add a section here covering shape / trigger / engine reaction / test.
5. If the engine added new detection code for this row, reference its
   stable error code in the section.
